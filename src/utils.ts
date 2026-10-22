import type { Action } from "./types";
import { performAction, type PerformAction } from "./actions";
import type {
  ActionSanitizer,
  DevtoolsConfig,
  Predicate,
  StateSanitizer,
} from "./config";
import type { ComputedState, LiftedActions, LiftedState } from "./reducer";

export function difference<T>(first: readonly T[], second: readonly T[]): T[] {
  return first.filter((item) => second.indexOf(item) < 0);
}

/**
 * Provides an app's view into the state of the lifted store: the state at
 * `currentStateIndex`.
 */
export function unliftState<S, A extends Action>(
  liftedState: LiftedState<S, A>,
): S {
  const { computedStates, currentStateIndex } = liftedState;

  // When init actions are filtered out by the predicate or safe/block list
  // options we don't have complete computed states yet. At this point it could
  // happen that we're out of bounds; fall back to the last known state.
  if (currentStateIndex >= computedStates.length) {
    const { state } = computedStates[computedStates.length - 1];
    return state;
  }

  const { state } = computedStates[currentStateIndex];
  return state;
}

export function unliftAction<S, A extends Action>(
  liftedState: LiftedState<S, A>,
): PerformAction<A> {
  return liftedState.actionsById[liftedState.nextActionId - 1];
}

/**
 * Lifts an app's action into an action on the lifted store.
 */
export function liftAction<A extends Action>(action: A): PerformAction<A> {
  return performAction(action, Date.now());
}

/**
 * Sanitizes given actions with given function.
 */
export function sanitizeActions<A extends Action>(
  actionSanitizer: ActionSanitizer<A>,
  actions: LiftedActions<A>,
): LiftedActions<Action> {
  return Object.keys(actions).reduce<LiftedActions<Action>>(
    (sanitizedActions, actionIdx) => {
      const idx = Number(actionIdx);
      sanitizedActions[idx] = sanitizeAction(
        actionSanitizer,
        actions[idx],
        idx,
      );
      return sanitizedActions;
    },
    {},
  );
}

/**
 * Sanitizes given action with given function.
 */
export function sanitizeAction<A extends Action>(
  actionSanitizer: ActionSanitizer<A>,
  action: PerformAction<A>,
  actionIdx: number,
): PerformAction<Action> {
  return {
    ...action,
    action: actionSanitizer(action.action, actionIdx),
  };
}

/**
 * Sanitizes given states with given function.
 */
export function sanitizeStates<S>(
  stateSanitizer: StateSanitizer<S>,
  states: ComputedState<S>[],
): ComputedState<unknown>[] {
  return states.map((computedState, idx) => ({
    state: sanitizeState(stateSanitizer, computedState.state, idx),
    error: computedState.error,
  }));
}

/**
 * Sanitizes given state with given function.
 */
export function sanitizeState<S>(
  stateSanitizer: StateSanitizer<S>,
  state: S,
  stateIdx: number,
): unknown {
  return stateSanitizer(state, stateIdx);
}

/**
 * Read the config and tell if actions should be filtered.
 */
export function shouldFilterActions<S, A extends Action>(
  config: Pick<
    DevtoolsConfig<S, A>,
    "predicate" | "actionsSafelist" | "actionsBlocklist"
  >,
): boolean {
  return Boolean(
    config.predicate || config.actionsSafelist || config.actionsBlocklist,
  );
}

/**
 * Return a full filtered lifted state.
 */
export function filterLiftedState<S, A extends Action>(
  liftedState: LiftedState<S, A>,
  predicate?: Predicate<S, A>,
  safelist?: string[],
  blocklist?: string[],
): LiftedState<S, A> {
  const filteredStagedActionIds: number[] = [];
  const filteredActionsById: LiftedActions<A> = {};
  const filteredComputedStates: ComputedState<S>[] = [];
  liftedState.stagedActionIds.forEach((id, idx) => {
    const liftedAction = liftedState.actionsById[id];
    if (!liftedAction) return;
    if (
      idx &&
      isActionFiltered(
        liftedState.computedStates[idx].state,
        liftedAction,
        predicate,
        safelist,
        blocklist,
      )
    ) {
      return;
    }
    filteredActionsById[id] = liftedAction;
    filteredStagedActionIds.push(id);
    filteredComputedStates.push(liftedState.computedStates[idx]);
  });
  return {
    ...liftedState,
    stagedActionIds: filteredStagedActionIds,
    actionsById: filteredActionsById,
    computedStates: filteredComputedStates,
  };
}

/**
 * Return true if the action should be ignored.
 */
export function isActionFiltered<S, A extends Action>(
  state: S,
  action: PerformAction<A>,
  predicate?: Predicate<S, A>,
  safelist?: string[],
  blocklist?: string[],
): boolean {
  const predicateMatch = predicate && !predicate(state, action.action);
  const safelistMatch =
    safelist &&
    !action.action.type.match(safelist.map((s) => escapeRegExp(s)).join("|"));
  const blocklistMatch =
    blocklist &&
    action.action.type.match(blocklist.map((s) => escapeRegExp(s)).join("|"));
  return Boolean(predicateMatch || safelistMatch || blocklistMatch);
}

/**
 * Return string with escaped RegExp special characters
 * https://stackoverflow.com/a/6969486/1337347
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
