import type { Action, ActionReducer } from "./types";
import {
  COMMIT,
  IMPORT_STATE,
  JUMP_TO_ACTION,
  JUMP_TO_STATE,
  LOCK_CHANGES,
  PAUSE_RECORDING,
  PERFORM_ACTION,
  RESET,
  ROLLBACK,
  SET_ACTIONS_ACTIVE,
  SWEEP,
  TOGGLE_ACTION,
  performAction,
  type HistoryAction,
  type PerformAction,
} from "./actions";
import type { DevtoolsConfig, MonitorReducer } from "./config";
import { difference, isActionFiltered, liftAction, unliftState } from "./utils";

/*
 * System actions. They are passed to your reducer like any other action
 * (exactly as `@ngrx/store` passes `@ngrx/store/init` and friends), so a
 * reducer must return its state unchanged for unknown action types.
 */
export const SYSTEM_ACTION_PREFIX = "@rxjs-devtools/";
export const INIT = "@rxjs-devtools/init" as const;
export const UPDATE = "@rxjs-devtools/update-reducer" as const;
export const RECOMPUTE = "@rxjs-devtools/recompute" as const;
export const PAUSE = "@rxjs-devtools/pause" as const;

export interface InitAction {
  readonly type: typeof INIT;
}

export interface UpdateReducerAction {
  readonly type: typeof UPDATE;
}

export interface RecomputeAction {
  readonly type: typeof RECOMPUTE;
}

export interface PauseAction {
  readonly type: typeof PAUSE;
}

export type SystemAction =
  InitAction | UpdateReducerAction | RecomputeAction | PauseAction;

export const INIT_ACTION: InitAction = { type: INIT };
export const UPDATE_ACTION: UpdateReducerAction = { type: UPDATE };
export const RECOMPUTE_ACTION: RecomputeAction = { type: RECOMPUTE };
export const PAUSE_ACTION: PauseAction = { type: PAUSE };

/**
 * Tells whether an action was produced by the library itself rather than by
 * the application.
 */
export function isSystemAction(action: Action): action is SystemAction {
  return action.type.startsWith(SYSTEM_ACTION_PREFIX);
}

/**
 * Everything the lifted reducer accepts: devtools history actions, the two
 * lifecycle actions and (through the `default` branch) monitor actions.
 */
export type DevtoolsAction<S = unknown, A extends Action = Action> =
  HistoryAction<S, A> | InitAction | UpdateReducerAction;

export interface ComputedState<S> {
  state: S;
  error?: string | null;
}

export interface LiftedActions<A extends Action = Action> {
  [id: number]: PerformAction<A>;
}

/**
 * The complete history of the instrumented store. This is what the Redux
 * DevTools extension receives on full updates and what `exportState` /
 * `importState` exchange.
 */
export interface LiftedState<S = unknown, A extends Action = Action> {
  monitorState: unknown;
  nextActionId: number;
  actionsById: LiftedActions<A>;
  stagedActionIds: number[];
  skippedActionIds: number[];
  committedState: S;
  currentStateIndex: number;
  computedStates: ComputedState<S>[];
  isLocked: boolean;
  isPaused: boolean;
}

export type LiftedReducer<S, A extends Action> = (
  liftedState: LiftedState<S, A> | undefined,
  liftedAction: DevtoolsAction<S, A>,
) => LiftedState<S, A>;

type HistoryOptions<S, A extends Action> = Partial<
  Pick<
    DevtoolsConfig<S, A>,
    "maxAge" | "predicate" | "actionsSafelist" | "actionsBlocklist"
  >
>;

/**
 * Computes the next entry in the log by applying an action.
 */
function computeNextEntry<S>(
  reducer: ActionReducer<S, Action>,
  action: Action,
  state: S,
  error: string | null | undefined,
  onError: (error: unknown) => void,
): ComputedState<S> {
  if (error) {
    return {
      state,
      error: "Interrupted by an error up the chain",
    };
  }

  let nextState = state;
  let nextError: string | undefined;
  try {
    nextState = reducer(state, action);
  } catch (err) {
    nextError = String(err);
    onError(err);
  }

  return {
    state: nextState,
    error: nextError,
  };
}

/**
 * Runs the reducer on invalidated actions to get a fresh computation log.
 */
function recomputeStates<S, A extends Action>(
  computedStates: ComputedState<S>[],
  minInvalidatedStateIndex: number,
  reducer: ActionReducer<S, Action>,
  committedState: S,
  actionsById: LiftedActions<A>,
  stagedActionIds: number[],
  skippedActionIds: number[],
  onError: (error: unknown) => void,
  isPaused: boolean,
): ComputedState<S>[] {
  // Optimization: exit early and return the same reference
  // if we know nothing could have changed.
  if (
    minInvalidatedStateIndex >= computedStates.length &&
    computedStates.length === stagedActionIds.length
  ) {
    return computedStates;
  }

  const nextComputedStates = computedStates.slice(0, minInvalidatedStateIndex);
  // If the recording is paused, recompute all states up until the pause state,
  // else recompute all states.
  const lastIncludedActionId = stagedActionIds.length - (isPaused ? 1 : 0);
  for (let i = minInvalidatedStateIndex; i < lastIncludedActionId; i++) {
    const actionId = stagedActionIds[i];
    const action = actionsById[actionId].action;

    const previousEntry = nextComputedStates[i - 1];
    const previousState = previousEntry ? previousEntry.state : committedState;
    const previousError = previousEntry ? previousEntry.error : undefined;

    const shouldSkip = skippedActionIds.indexOf(actionId) > -1;
    const entry: ComputedState<S> = shouldSkip
      ? previousEntry
      : computeNextEntry(
          reducer,
          action,
          previousState,
          previousError,
          onError,
        );

    nextComputedStates.push(entry);
  }
  // If the recording is paused, the last state will not be recomputed,
  // because it's essentially not part of the state history.
  if (isPaused) {
    nextComputedStates.push(computedStates[computedStates.length - 1]);
  }

  return nextComputedStates;
}

export function liftInitialState<S, A extends Action>(
  initialCommittedState: S,
  monitorReducer: MonitorReducer,
): LiftedState<S, A> {
  return {
    monitorState: monitorReducer(undefined, INIT_ACTION),
    nextActionId: 1,
    actionsById: { 0: liftAction(INIT_ACTION as Action as A) },
    stagedActionIds: [0],
    skippedActionIds: [],
    committedState: initialCommittedState,
    currentStateIndex: 0,
    computedStates: [],
    isLocked: false,
    isPaused: false,
  };
}

/**
 * Creates a history state reducer from an app's reducer.
 *
 * This is a faithful port of `liftReducerWith` from `@ngrx/store-devtools`
 * (itself derived from `redux-devtools-instrument`), with Angular's
 * `ErrorHandler` replaced by an `onError` callback.
 */
export function liftReducerWith<S, A extends Action>(
  initialCommittedState: S,
  initialLiftedState: LiftedState<S, A>,
  onError: (error: unknown) => void,
  monitorReducer: MonitorReducer,
  options: HistoryOptions<S, A> = {},
): (reducer: ActionReducer<S, A>) => LiftedReducer<S, A> {
  /**
   * Manages how the history actions modify the history state.
   */
  return (appReducer) => (liftedState, liftedAction) => {
    // System actions (INIT, UPDATE, RECOMPUTE) are handed to the app reducer
    // as well, so widen its action type once here.
    const reducer = appReducer as ActionReducer<S, Action>;

    let {
      monitorState,
      actionsById,
      nextActionId,
      stagedActionIds,
      skippedActionIds,
      committedState,
      currentStateIndex,
      computedStates,
      isLocked,
      isPaused,
    } = liftedState || initialLiftedState;

    if (!liftedState) {
      // Prevent mutating initialLiftedState
      actionsById = Object.create(actionsById) as LiftedActions<A>;
    }

    function commitExcessActions(n: number): void {
      // Auto-commits n-number of excess actions.
      let excess = n;
      let idsToDelete = stagedActionIds.slice(1, excess + 1);

      for (let i = 0; i < idsToDelete.length; i++) {
        if (computedStates[i + 1].error) {
          // Stop if error is found. Commit actions up to error.
          excess = i;
          idsToDelete = stagedActionIds.slice(1, excess + 1);
          break;
        } else {
          delete actionsById[idsToDelete[i]];
        }
      }

      skippedActionIds = skippedActionIds.filter(
        (id) => idsToDelete.indexOf(id) === -1,
      );
      stagedActionIds = [0, ...stagedActionIds.slice(excess + 1)];
      committedState = computedStates[excess].state;
      computedStates = computedStates.slice(excess);
      currentStateIndex =
        currentStateIndex > excess ? currentStateIndex - excess : 0;
    }

    function commitChanges(): void {
      // Consider the last committed state the new starting point.
      // Squash any staged actions into a single committed state.
      actionsById = { 0: liftAction(INIT_ACTION as Action as A) };
      nextActionId = 1;
      stagedActionIds = [0];
      skippedActionIds = [];
      committedState = computedStates[currentStateIndex].state;
      currentStateIndex = 0;
      computedStates = [];
    }

    // By default, aggressively recompute every state whatever happens.
    // This has O(n) performance, so we'll override this to a sensible
    // value whenever we feel like we don't have to recompute the states.
    let minInvalidatedStateIndex = 0;

    switch (liftedAction.type) {
      case LOCK_CHANGES: {
        isLocked = liftedAction.status;
        minInvalidatedStateIndex = Infinity;
        break;
      }
      case PAUSE_RECORDING: {
        isPaused = liftedAction.status;
        if (isPaused) {
          // Add a pause action to signal the devtools-user the recording is paused.
          // The corresponding state will be overwritten on each update to always contain
          // the latest state (see PERFORM_ACTION).
          stagedActionIds = [...stagedActionIds, nextActionId];
          actionsById[nextActionId] = performAction(
            PAUSE_ACTION as Action as A,
            Date.now(),
          );
          nextActionId++;
          minInvalidatedStateIndex = stagedActionIds.length - 1;
          computedStates = computedStates.concat(
            computedStates[computedStates.length - 1],
          );

          if (currentStateIndex === stagedActionIds.length - 2) {
            currentStateIndex++;
          }
          minInvalidatedStateIndex = Infinity;
        } else {
          commitChanges();
        }
        break;
      }
      case RESET: {
        // Get back to the state the store was created with.
        actionsById = { 0: liftAction(INIT_ACTION as Action as A) };
        nextActionId = 1;
        stagedActionIds = [0];
        skippedActionIds = [];
        committedState = initialCommittedState;
        currentStateIndex = 0;
        computedStates = [];
        break;
      }
      case COMMIT: {
        commitChanges();
        break;
      }
      case ROLLBACK: {
        // Forget about any staged actions.
        // Start again from the last committed state.
        actionsById = { 0: liftAction(INIT_ACTION as Action as A) };
        nextActionId = 1;
        stagedActionIds = [0];
        skippedActionIds = [];
        currentStateIndex = 0;
        computedStates = [];
        break;
      }
      case TOGGLE_ACTION: {
        // Toggle whether an action with given ID is skipped.
        // Being skipped means it is a no-op during the computation.
        const { id: actionId } = liftedAction;
        const index = skippedActionIds.indexOf(actionId);
        if (index === -1) {
          skippedActionIds = [actionId, ...skippedActionIds];
        } else {
          skippedActionIds = skippedActionIds.filter((id) => id !== actionId);
        }
        // Optimization: we know history before this action hasn't changed
        minInvalidatedStateIndex = stagedActionIds.indexOf(actionId);
        break;
      }
      case SET_ACTIONS_ACTIVE: {
        // Toggle whether an action with given ID is skipped.
        // Being skipped means it is a no-op during the computation.
        const { start, end, active } = liftedAction;
        const actionIds: number[] = [];
        for (let i = start; i < end; i++) actionIds.push(i);
        if (active) {
          skippedActionIds = difference(skippedActionIds, actionIds);
        } else {
          skippedActionIds = [...skippedActionIds, ...actionIds];
        }

        // Optimization: we know history before this action hasn't changed
        minInvalidatedStateIndex = stagedActionIds.indexOf(start);
        break;
      }
      case JUMP_TO_STATE: {
        // Without recomputing anything, move the pointer that tell us
        // which state is considered the current one. Useful for sliders.
        currentStateIndex = liftedAction.index;
        // Optimization: we know the history has not changed.
        minInvalidatedStateIndex = Infinity;
        break;
      }
      case JUMP_TO_ACTION: {
        // Jumps to a corresponding state to a specific action.
        // Useful when filtering actions.
        const index = stagedActionIds.indexOf(liftedAction.actionId);
        if (index !== -1) currentStateIndex = index;
        minInvalidatedStateIndex = Infinity;
        break;
      }
      case SWEEP: {
        // Forget any actions that are currently being skipped.
        stagedActionIds = difference(stagedActionIds, skippedActionIds);
        skippedActionIds = [];
        currentStateIndex = Math.min(
          currentStateIndex,
          stagedActionIds.length - 1,
        );
        break;
      }
      case PERFORM_ACTION: {
        // Ignore action and return state as is if recording is locked
        if (isLocked) {
          return liftedState || initialLiftedState;
        }

        if (
          isPaused ||
          (liftedState &&
            isActionFiltered(
              unliftState(liftedState),
              liftedAction,
              options.predicate,
              options.actionsSafelist,
              options.actionsBlocklist,
            ))
        ) {
          // If recording is paused or if the action should be ignored, overwrite the last state
          // (corresponds to the pause action) and keep everything else as is.
          // This way, the app gets the new current state while the devtools
          // do not record another action.
          const lastState = computedStates[computedStates.length - 1];
          computedStates = [
            ...computedStates.slice(0, -1),
            computeNextEntry(
              reducer,
              liftedAction.action,
              lastState.state,
              lastState.error,
              onError,
            ),
          ];
          minInvalidatedStateIndex = Infinity;
          break;
        }

        // Auto-commit as new actions come in.
        if (options.maxAge && stagedActionIds.length === options.maxAge) {
          commitExcessActions(1);
        }

        if (currentStateIndex === stagedActionIds.length - 1) {
          currentStateIndex++;
        }
        const actionId = nextActionId++;
        // Mutation! This is the hottest path, and we optimize on purpose.
        // It is safe because we set a new key in a cache dictionary.
        actionsById[actionId] = liftedAction;

        stagedActionIds = [...stagedActionIds, actionId];
        // Optimization: we know that only the new action needs computing.
        minInvalidatedStateIndex = stagedActionIds.length - 1;
        break;
      }
      case IMPORT_STATE: {
        // Completely replace everything.
        ({
          monitorState,
          actionsById,
          nextActionId,
          stagedActionIds,
          skippedActionIds,
          committedState,
          currentStateIndex,
          computedStates,
          isLocked,
          isPaused,
        } = liftedAction.nextLiftedState);
        break;
      }
      case INIT: {
        // Always recompute states on hot reload and init.
        minInvalidatedStateIndex = 0;

        if (options.maxAge && stagedActionIds.length > options.maxAge) {
          // States must be recomputed before committing excess.
          computedStates = recomputeStates(
            computedStates,
            minInvalidatedStateIndex,
            reducer,
            committedState,
            actionsById,
            stagedActionIds,
            skippedActionIds,
            onError,
            isPaused,
          );

          commitExcessActions(stagedActionIds.length - options.maxAge);

          // Avoid double computation.
          minInvalidatedStateIndex = Infinity;
        }

        break;
      }
      case UPDATE: {
        const stateHasErrors =
          computedStates.filter((state) => state.error).length > 0;

        if (stateHasErrors) {
          // Recompute all states
          minInvalidatedStateIndex = 0;

          if (options.maxAge && stagedActionIds.length > options.maxAge) {
            // States must be recomputed before committing excess.
            computedStates = recomputeStates(
              computedStates,
              minInvalidatedStateIndex,
              reducer,
              committedState,
              actionsById,
              stagedActionIds,
              skippedActionIds,
              onError,
              isPaused,
            );

            commitExcessActions(stagedActionIds.length - options.maxAge);

            // Avoid double computation.
            minInvalidatedStateIndex = Infinity;
          }
        } else {
          // If not paused/locked, add a new action to signal devtools-user
          // that there was a reducer update.
          if (!isPaused && !isLocked) {
            if (currentStateIndex === stagedActionIds.length - 1) {
              currentStateIndex++;
            }

            // Add a new action to only recompute state
            const actionId = nextActionId++;
            actionsById[actionId] = performAction(
              liftedAction as Action as A,
              Date.now(),
            );
            stagedActionIds = [...stagedActionIds, actionId];

            minInvalidatedStateIndex = stagedActionIds.length - 1;

            computedStates = recomputeStates(
              computedStates,
              minInvalidatedStateIndex,
              reducer,
              committedState,
              actionsById,
              stagedActionIds,
              skippedActionIds,
              onError,
              isPaused,
            );
          }

          // Recompute state history with latest reducer and update action
          computedStates = computedStates.map((cmp) => ({
            ...cmp,
            state: reducer(cmp.state, RECOMPUTE_ACTION),
          }));

          currentStateIndex = stagedActionIds.length - 1;

          if (options.maxAge && stagedActionIds.length > options.maxAge) {
            commitExcessActions(stagedActionIds.length - options.maxAge);
          }

          // Avoid double computation.
          minInvalidatedStateIndex = Infinity;
        }

        break;
      }
      default: {
        // If the action is not recognized, it's a monitor action.
        // Optimization: a monitor action can't change history.
        minInvalidatedStateIndex = Infinity;
        break;
      }
    }

    computedStates = recomputeStates(
      computedStates,
      minInvalidatedStateIndex,
      reducer,
      committedState,
      actionsById,
      stagedActionIds,
      skippedActionIds,
      onError,
      isPaused,
    );
    monitorState = monitorReducer(monitorState, liftedAction);

    return {
      monitorState,
      actionsById,
      nextActionId,
      stagedActionIds,
      skippedActionIds,
      committedState,
      currentStateIndex,
      computedStates,
      isLocked,
      isPaused,
    };
  };
}
