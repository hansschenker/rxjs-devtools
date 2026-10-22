import {
  BehaviorSubject,
  Observable,
  ReplaySubject,
  Subject,
  Subscription,
  map,
  merge,
  observeOn,
  queueScheduler,
  scan,
  withLatestFrom,
} from "rxjs";

import * as Actions from "./actions";
import { PERFORM_ACTION } from "./actions";
import {
  createConfig,
  type DevtoolsConfig,
  type DevtoolsOptions,
} from "./config";
import { createExtensionBridge } from "./extension";
import {
  INIT_ACTION,
  UPDATE_ACTION,
  liftInitialState,
  liftReducerWith,
  type DevtoolsAction,
  type LiftedReducer,
  type LiftedState,
} from "./reducer";
import { getReduxDevtoolsExtension } from "./redux-devtools";
import type { Action, ActionReducer } from "./types";
import {
  filterLiftedState,
  liftAction,
  shouldFilterActions,
  unliftState,
} from "./utils";

/**
 * Programmatic access to every history command the Redux DevTools extension
 * can issue. The same commands arrive through the extension when you click
 * around in its UI.
 */
export interface DevtoolsController<S, A extends Action = Action> {
  /**
   * Dispatches a raw lifted action. Unknown action types are treated as
   * monitor actions and leave the history untouched.
   */
  dispatch(action: DevtoolsAction<S, A> | Action): void;
  /** Re-sends the full lifted state to the extension. */
  refresh(): void;
  /** Goes back to the state the store was created with. */
  reset(): void;
  /** Forgets staged actions and restarts from the last committed state. */
  rollback(): void;
  /** Squashes the staged actions into a new committed state. */
  commit(): void;
  /** Forgets every skipped action. */
  sweep(): void;
  /** Skips / un-skips the action with the given id. */
  toggleAction(id: number): void;
  /** Skips (`active: false`) or un-skips a range of action ids `[start, end)`. */
  setActionsActive(start: number, end: number, active?: boolean): void;
  /** Moves the current state pointer to the given index in `computedStates`. */
  jumpToState(index: number): void;
  /** Moves the current state pointer to the state produced by the given action id. */
  jumpToAction(actionId: number): void;
  /** Replaces the entire history, e.g. with one exported earlier. */
  importState(nextLiftedState: LiftedState<S, A>): void;
  /** Locks (`true`) or unlocks dispatching application actions. */
  lockChanges(status: boolean): void;
  /** Pauses (`true`) or resumes recording. While paused, actions still update the state. */
  pauseRecording(status: boolean): void;
}

/**
 * A reducer-driven store with a complete, time-travelable history, connected
 * to the Redux DevTools extension when it is installed.
 */
export interface InstrumentedStore<S, A extends Action = Action> {
  /** Dispatches an application action. */
  dispatch(action: A): void;
  /**
   * The current application state. Replays the latest value to new
   * subscribers, emits once per dispatched action and whenever a devtools
   * command (jump, skip, rollback, ...) changes the current state.
   */
  readonly state$: Observable<S>;
  /**
   * Application actions after they have been reduced into the state,
   * including actions dispatched from the extension's dispatcher UI.
   */
  readonly actions$: Observable<A>;
  /** The full history, emitted after every lifted action. */
  readonly liftedState$: Observable<LiftedState<S, A>>;
  getState(): S;
  getLiftedState(): LiftedState<S, A>;
  /**
   * Swaps the reducer (hot reloading). The history is recomputed with the
   * new reducer and the extension is informed.
   */
  replaceReducer(reducer: ActionReducer<S, A>): void;
  /** Time travel and history commands. */
  readonly devtools: DevtoolsController<S, A>;
  /** The fully resolved configuration. */
  readonly config: DevtoolsConfig<S, A>;
  /** Disconnects from the extension and completes every stream. */
  destroy(): void;
}

function assertDispatchable(action: unknown): asserts action is Action {
  if (typeof action === "function") {
    throw new TypeError(
      "Dispatch expected an object, instead it received a function. " +
        "If you are using an action creator, make sure to invoke the " +
        "function before dispatching the action.",
    );
  }
  if (typeof action !== "object" || action === null) {
    throw new TypeError("Actions must be objects");
  }
  if (typeof (action as { type?: unknown }).type === "undefined") {
    throw new TypeError("Actions must have a type property");
  }
}

/**
 * Instruments a reducer with the Redux DevTools lifted-state machinery.
 *
 * This is the RxJS equivalent of `provideStoreDevtools()` plus the store it
 * instruments: `actions$.pipe(scan(reducer, initialState))` with the
 * complete action history kept around, so the Redux DevTools extension can
 * jump, skip, commit, rollback, import and export.
 *
 * ```ts
 * const store = instrument(counterReducer, 0, { name: "Counter" });
 * store.state$.subscribe(render);
 * store.dispatch({ type: "INCREMENT" });
 * ```
 */
export function instrument<S, A extends Action = Action>(
  reducer: ActionReducer<S, A>,
  initialState: S,
  options: DevtoolsOptions<S, A> = {},
): InstrumentedStore<S, A> {
  const config = createConfig<S, A>(options);
  const extension =
    config.extension === undefined
      ? getReduxDevtoolsExtension()
      : config.extension;
  const bridge = createExtensionBridge<S, A>(extension, config);

  // Application actions dispatched through `store.dispatch`.
  const appActions = new Subject<A>();
  // Lifted actions (history commands). Seeded with INIT exactly like the
  // `DevtoolsDispatcher` (an `ActionsSubject`) of `@ngrx/store-devtools`,
  // which is what produces the very first computed state.
  const dispatcher = new BehaviorSubject<DevtoolsAction<S, A>>(INIT_ACTION);
  const reducer$ = new BehaviorSubject<ActionReducer<S, A>>(reducer);
  const scannedActions = new Subject<A>();
  const liftedStateSubject = new ReplaySubject<LiftedState<S, A>>(1);
  const stateSubject = new ReplaySubject<S>(1);

  const liftedInitialState = liftInitialState<S, A>(
    initialState,
    config.monitor,
  );
  const liftReducer = liftReducerWith<S, A>(
    initialState,
    liftedInitialState,
    config.onError,
    config.monitor,
    config,
  );

  const liftedAction$: Observable<DevtoolsAction<S, A>> = merge(
    merge(appActions, bridge.actions$).pipe(map(liftAction)),
    dispatcher,
    bridge.liftedActions$,
  ).pipe(observeOn(queueScheduler));

  const liftedReducer$ = reducer$.pipe(map(liftReducer));

  let currentLiftedState: LiftedState<S, A> = liftedInitialState;
  let currentState: S = initialState;
  let hasState = false;

  const subscription = new Subscription();

  subscription.add(
    liftedAction$
      .pipe(
        withLatestFrom(liftedReducer$),
        scan<
          [DevtoolsAction<S, A>, LiftedReducer<S, A>],
          { state: LiftedState<S, A>; action: DevtoolsAction<S, A> }
        >(
          ({ state: liftedState }, [action, reduce]) => {
            let reducedLiftedState = reduce(liftedState, action);
            // On full state update
            // If we have actions filters, we must filter completely our lifted state to be sync with the extension
            if (action.type !== PERFORM_ACTION && shouldFilterActions(config)) {
              reducedLiftedState = filterLiftedState(
                reducedLiftedState,
                config.predicate,
                config.actionsSafelist,
                config.actionsBlocklist,
              );
            }
            // Extension should be sent the sanitized lifted state
            bridge.notify(action, reducedLiftedState);
            return { state: reducedLiftedState, action };
          },
          { state: liftedInitialState, action: INIT_ACTION },
        ),
      )
      .subscribe(({ state, action }) => {
        currentLiftedState = state;
        liftedStateSubject.next(state);

        const nextState = unliftState(state);
        const isPerform = action.type === PERFORM_ACTION;
        if (!hasState || isPerform || nextState !== currentState) {
          hasState = true;
          currentState = nextState;
          stateSubject.next(nextState);
        }

        if (isPerform) {
          scannedActions.next((action as Actions.PerformAction<A>).action);
        }
      }),
  );

  const devtools: DevtoolsController<S, A> = {
    dispatch(action) {
      dispatcher.next(action as DevtoolsAction<S, A>);
    },
    refresh() {
      dispatcher.next(Actions.refresh());
    },
    reset() {
      dispatcher.next(Actions.reset());
    },
    rollback() {
      dispatcher.next(Actions.rollback());
    },
    commit() {
      dispatcher.next(Actions.commit());
    },
    sweep() {
      dispatcher.next(Actions.sweep());
    },
    toggleAction(id) {
      dispatcher.next(Actions.toggleAction(id));
    },
    setActionsActive(start, end, active = true) {
      dispatcher.next(Actions.setActionsActive(start, end, active));
    },
    jumpToState(index) {
      dispatcher.next(Actions.jumpToState(index));
    },
    jumpToAction(actionId) {
      dispatcher.next(Actions.jumpToAction(actionId));
    },
    importState(nextLiftedState) {
      dispatcher.next(Actions.importState(nextLiftedState));
    },
    lockChanges(status) {
      dispatcher.next(Actions.lockChanges(status));
    },
    pauseRecording(status) {
      dispatcher.next(Actions.pauseRecording(status));
    },
  };

  // When the extension monitor opens it needs the full history.
  subscription.add(bridge.start$.subscribe(() => devtools.refresh()));

  return {
    dispatch(action) {
      assertDispatchable(action);
      appActions.next(action);
    },
    state$: stateSubject.asObservable(),
    actions$: scannedActions.asObservable(),
    liftedState$: liftedStateSubject.asObservable(),
    getState: () => currentState,
    getLiftedState: () => currentLiftedState,
    replaceReducer(nextReducer) {
      reducer$.next(nextReducer);
      dispatcher.next(UPDATE_ACTION);
    },
    devtools,
    config,
    destroy() {
      subscription.unsubscribe();
      appActions.complete();
      dispatcher.complete();
      reducer$.complete();
      scannedActions.complete();
      liftedStateSubject.complete();
      stateSubject.complete();
    },
  };
}
