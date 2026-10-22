import {
  EMPTY,
  Observable,
  filter,
  map,
  share,
  switchMap,
  takeUntil,
} from "rxjs";

import { PERFORM_ACTION, type PerformAction } from "./actions";
import type { DevtoolsConfig } from "./config";
import type { DevtoolsAction, LiftedState } from "./reducer";
import type {
  ActionCreatorDescriptor,
  ExtensionMessage,
  ReduxDevtoolsExtension,
  ReduxDevtoolsExtensionConfig,
  ReduxDevtoolsExtensionConnection,
} from "./redux-devtools";
import type { Action, ActionCreator } from "./types";
import {
  isActionFiltered,
  sanitizeAction,
  sanitizeActions,
  sanitizeState,
  sanitizeStates,
  shouldFilterActions,
  unliftState,
} from "./utils";

export const ExtensionActionTypes = {
  START: "START",
  DISPATCH: "DISPATCH",
  STOP: "STOP",
  ACTION: "ACTION",
} as const;

/**
 * The page-side half of the Redux DevTools extension protocol: streams of
 * what the extension asks for, and `notify` to tell it what happened.
 *
 * The extension connection is established lazily when one of the streams is
 * subscribed and torn down when the last subscription ends.
 */
export interface ExtensionBridge<S, A extends Action> {
  /** Application actions dispatched from the extension's dispatcher UI. */
  readonly actions$: Observable<A>;
  /** History commands (jump, skip, commit, ...) issued in the extension. */
  readonly liftedActions$: Observable<DevtoolsAction<S, A>>;
  /** Emits when the extension monitor opens and starts listening. */
  readonly start$: Observable<ExtensionMessage>;
  /** Sends an action and its resulting (lifted) state to the extension. */
  notify(action: DevtoolsAction<S, A>, state: LiftedState<S, A>): void;
}

/**
 * The payload the extension sends when an action is dispatched from its
 * dispatcher using one of the configured action creators. `selected` is the
 * index of the action creator and `args` contains the entered arguments as
 * strings of JavaScript.
 */
interface ActionCreatorPayload {
  name: string;
  selected: number;
  args: string[];
  rest: string;
}

function isActionCreatorPayload(
  action: unknown,
): action is ActionCreatorPayload {
  return (
    typeof action === "object" &&
    action !== null &&
    !("type" in action) &&
    typeof (action as ActionCreatorPayload).selected === "number" &&
    Array.isArray((action as ActionCreatorPayload).args)
  );
}

/**
 * Parse the parameter names out of an action creator so the extension can
 * render input fields for them in its dispatcher.
 */
function getActionCreatorArgs(actionCreator: ActionCreator): string[] {
  const source = String(actionCreator);
  const parenthesizedArgs = source.match(/^[^(]*\(([^)]*)\)/);
  if (!parenthesizedArgs) {
    // arrow function with a single parameter without parentheses
    const singleArg = source.match(/^\s*([^=\s(]+)\s*=>/);
    return singleArg ? [singleArg[1]] : [];
  }
  return parenthesizedArgs[1]
    .split(",")
    .map((arg) =>
      arg
        .replace(/^\s*\.{3}/, "")
        .split("=")[0]
        .trim(),
    )
    .filter((arg) => arg !== "");
}

export function getActionCreatorDescriptors(
  actionCreators: ActionCreator[] | Record<string, ActionCreator>,
): ActionCreatorDescriptor[] {
  if (Array.isArray(actionCreators)) {
    return actionCreators.map((actionCreator) => ({
      name: actionCreator.type || actionCreator.name || "anonymous",
      func: actionCreator,
      args: getActionCreatorArgs(actionCreator),
    }));
  }
  return Object.keys(actionCreators).map((name) => ({
    name,
    func: actionCreators[name],
    args: getActionCreatorArgs(actionCreators[name]),
  }));
}

// indirect eval according to https://esbuild.github.io/content-types/#direct-eval
const evalArg = (arg: string): unknown =>
  arg === "" ? undefined : (0, eval)(`(${arg})`);

/**
 * Turns an extension payload into an action.
 *
 * The extension sends hand-typed actions as JavaScript source strings and
 * action-creator dispatches as `{ selected, args, rest }` payloads.
 */
export function unwrapAction(
  payload: unknown,
  actionCreatorDescriptors?: ActionCreatorDescriptor[],
): unknown {
  if (typeof payload === "string") {
    // indirect eval according to https://esbuild.github.io/content-types/#direct-eval
    return (0, eval)(`(${payload})`);
  }
  // When action creators are configured, the extension dispatches them as a
  // `{ selected, args }` payload that refers back to the configured action
  // creators instead of a ready-made action.
  if (actionCreatorDescriptors && isActionCreatorPayload(payload)) {
    const descriptor = actionCreatorDescriptors[payload.selected];
    if (descriptor) {
      const args = payload.args.map(evalArg);
      if (payload.rest) {
        const rest = evalArg(payload.rest);
        if (Array.isArray(rest)) {
          args.push(...rest);
        }
      }
      return (descriptor.func as (...args: unknown[]) => Action)(...args);
    }
  }
  return payload;
}

export function getExtensionConfig<S, A extends Action>(
  config: DevtoolsConfig<S, A>,
  actionCreatorDescriptors?: ActionCreatorDescriptor[],
): ReduxDevtoolsExtensionConfig {
  const extensionOptions: ReduxDevtoolsExtensionConfig = {
    name: config.name,
    features: config.features,
    serialize: config.serialize,
    autoPause: config.autoPause ?? false,
    trace: config.trace ?? false,
    traceLimit: config.traceLimit ?? 75,
    // The action/state sanitizers are not added to the config
    // because sanitation is done in `notify` already.
    // It is done before sending it to the devtools extension for consistency:
    // - If we call extensionConnection.send(...),
    //   the extension would call the sanitizers.
    // - If we call devtoolsExtension.send(...) (aka full state update),
    //   the extension would NOT call the sanitizers, so we have to do it ourselves.
  };
  if (config.maxAge !== false /* support === 0 */) {
    extensionOptions.maxAge = config.maxAge;
  }
  if (actionCreatorDescriptors) {
    extensionOptions.actionCreators = actionCreatorDescriptors;
  }
  return extensionOptions;
}

function sendToReduxDevtools(send: () => void): void {
  try {
    send();
  } catch (err) {
    console.warn(
      "rxjs-devtools: something went wrong inside the redux devtools",
      err,
    );
  }
}

/**
 * Creates the bridge to the Redux DevTools extension for one instrumented
 * store. Pass `null` as `extension` to get an inert bridge.
 */
export function createExtensionBridge<S, A extends Action>(
  extension: ReduxDevtoolsExtension | null,
  config: DevtoolsConfig<S, A>,
): ExtensionBridge<S, A> {
  const actionCreatorDescriptors = config.actionCreators
    ? getActionCreatorDescriptors(config.actionCreators)
    : undefined;
  const extensionConfig = getExtensionConfig(config, actionCreatorDescriptors);

  let connection: ReduxDevtoolsExtensionConnection | undefined;

  // Listens to all changes
  const changes$: Observable<ExtensionMessage> = extension
    ? new Observable<ExtensionMessage>((subscriber) => {
        const current = extension.connect(extensionConfig);
        connection = current;
        current.init();
        current.subscribe((message) => subscriber.next(message));
        return () => {
          current.unsubscribe();
          if (connection === current) {
            connection = undefined;
          }
        };
      }).pipe(share())
    : EMPTY;

  // Listen for the start action
  const start$ = changes$.pipe(
    filter((message) => message.type === ExtensionActionTypes.START),
  );

  // Listen for the stop action
  const stop$ = changes$.pipe(
    filter((message) => message.type === ExtensionActionTypes.STOP),
  );

  // Listen for lifted actions
  const liftedActions$ = changes$.pipe(
    filter((message) => message.type === ExtensionActionTypes.DISPATCH),
    map(
      (message) =>
        unwrapAction(
          message.payload,
          actionCreatorDescriptors,
        ) as DevtoolsAction<S, A>,
    ),
  );

  // Listen for unlifted actions
  const actions$ = changes$.pipe(
    filter((message) => message.type === ExtensionActionTypes.ACTION),
    map(
      (message) => unwrapAction(message.payload, actionCreatorDescriptors) as A,
    ),
  );

  const actionsUntilStop$ = actions$.pipe(takeUntil(stop$));
  const liftedUntilStop$ = liftedActions$.pipe(takeUntil(stop$));
  const startUntilStop$ = start$.pipe(takeUntil(stop$));

  function notify(
    action: DevtoolsAction<S, A>,
    state: LiftedState<S, A>,
  ): void {
    if (!extension) {
      return;
    }
    // Check to see if the action requires a full update of the liftedState.
    // If it is a simple action generated by the user's app and the recording
    // is not locked/paused, only send the action and the current state (fast).
    //
    // A full liftedState update (slow: serializes the entire liftedState) is
    // only required when:
    //   a) redux-devtools-extension fires the @@Init action (ignored here)
    //   b) an action is generated by the library (e.g. update-reducer)
    //   c) the state has been recomputed due to time-traveling
    //   d) any action that is not a PerformAction to err on the side of
    //      caution.
    if (action.type === PERFORM_ACTION) {
      if (state.isLocked || state.isPaused) {
        return;
      }

      const currentState = unliftState(state);
      if (
        shouldFilterActions(config) &&
        isActionFiltered(
          currentState,
          action,
          config.predicate,
          config.actionsSafelist,
          config.actionsBlocklist,
        )
      ) {
        return;
      }
      const sanitizedState = config.stateSanitizer
        ? sanitizeState(
            config.stateSanitizer,
            currentState,
            state.currentStateIndex,
          )
        : currentState;
      const sanitizedAction: PerformAction<Action> = config.actionSanitizer
        ? sanitizeAction(config.actionSanitizer, action, state.nextActionId)
        : action;

      const target = connection;
      if (!target) {
        return;
      }
      sendToReduxDevtools(() => target.send(sanitizedAction, sanitizedState));
    } else {
      // Requires full state update
      const sanitizedLiftedState = {
        ...state,
        stagedActionIds: state.stagedActionIds,
        actionsById: config.actionSanitizer
          ? sanitizeActions(config.actionSanitizer, state.actionsById)
          : state.actionsById,
        computedStates: config.stateSanitizer
          ? sanitizeStates(config.stateSanitizer, state.computedStates)
          : state.computedStates,
      };

      sendToReduxDevtools(() =>
        extension.send(null, sanitizedLiftedState, extensionConfig),
      );
    }
  }

  return {
    start$: startUntilStop$,
    // Only take the action sources between the start/stop events
    actions$: startUntilStop$.pipe(switchMap(() => actionsUntilStop$)),
    liftedActions$: startUntilStop$.pipe(switchMap(() => liftedUntilStop$)),
    notify,
  };
}
