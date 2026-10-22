import type { Action, ActionCreator, ActionReducer } from "./types";
import type {
  DevtoolsFeatureOptions,
  ReduxDevtoolsExtension,
  SerializationOptions,
} from "./redux-devtools";

export type ActionSanitizer<A extends Action = Action> = (
  action: A,
  id: number,
) => Action;

export type StateSanitizer<S = unknown> = (state: S, index: number) => unknown;

export type Predicate<S = unknown, A extends Action = Action> = (
  state: S,
  action: A,
) => boolean;

/**
 * A reducer for monitor state, used by custom monitors. The default monitor
 * keeps no state.
 */
export type MonitorReducer = ActionReducer<unknown, Action>;

/**
 * Chrome extension documentation
 * @see https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md
 */
export interface DevtoolsConfig<S = unknown, A extends Action = Action> {
  /**
   * Maximum allowed actions to be stored in the history tree (default: `false`).
   * Older actions are auto-committed as new ones come in.
   */
  maxAge: number | false;
  /**
   * Reducer for custom monitor state (default: keeps no state).
   */
  monitor: MonitorReducer;
  /**
   * Function which takes an `action` object and id number as arguments, and
   * should return an `action` object back. Used before sending to the extension.
   */
  actionSanitizer?: ActionSanitizer<A>;
  /**
   * Function which takes a `state` object and index as arguments, and should
   * return a `state` object back. Used before sending to the extension.
   */
  stateSanitizer?: StateSanitizer<S>;
  /**
   * The instance name shown in the extension's instance selector
   * (default: `"RxJS DevTools"`).
   */
  name: string;
  serialize: boolean | SerializationOptions;
  /**
   * Restrict the extension to log-only features (pause, export, test).
   */
  logOnly: boolean;
  features: DevtoolsFeatureOptions;
  /**
   * Action types to be hidden in the monitors. If `actionsSafelist` is
   * specified, `actionsBlocklist` is ignored.
   */
  actionsBlocklist?: string[];
  /**
   * Action types to be shown in the monitors.
   */
  actionsSafelist?: string[];
  /**
   * Called for every action before sending, takes state and action object, and
   * returns true in case it allows sending the current data to the monitor.
   */
  predicate?: Predicate<S, A>;
  /**
   * Auto pauses when the extension's window is not opened, and so has zero
   * impact on your app when not in use.
   */
  autoPause: boolean;
  /**
   * If set to true, will include stack trace for every dispatched action.
   */
  trace: boolean | (() => string);
  /**
   * Maximum stack trace frames to be stored (in case trace option was provided as true).
   */
  traceLimit: number;
  /**
   * Action creators to make available in the extension's dispatcher,
   * so actions can be dispatched manually from the extension.
   */
  actionCreators?: ActionCreator[] | Record<string, ActionCreator>;
  /**
   * The extension to connect to. Defaults to
   * `globalThis.__REDUX_DEVTOOLS_EXTENSION__`; pass `null` to never connect
   * (useful in tests) or a custom implementation to bridge to something else.
   */
  extension?: ReduxDevtoolsExtension | null;
  /**
   * Called with errors thrown by your reducer while computing history. The
   * error is also recorded on the affected `computedStates` entry.
   * Defaults to `console.error`.
   */
  onError: (error: unknown) => void;
}

export type DevtoolsOptions<S = unknown, A extends Action = Action> =
  Partial<DevtoolsConfig<S, A>> | (() => Partial<DevtoolsConfig<S, A>>);

export function noMonitor(): null {
  return null;
}

export function defaultOnError(error: unknown): void {
  console.error(error);
}

export const DEFAULT_NAME = "RxJS DevTools";

export const DEFAULT_FEATURES: Readonly<DevtoolsFeatureOptions> = Object.freeze(
  {
    pause: true, // Start/pause recording of dispatched actions
    lock: true, // Lock/unlock dispatching actions and side effects
    persist: true, // Persist states on page reloading
    export: true, // Export history of actions in a file
    import: "custom", // Import history of actions from a file
    jump: true, // Jump back and forth (time travelling)
    skip: true, // Skip (cancel) actions
    reorder: true, // Drag and drop actions in the history list
    dispatch: true, // Dispatch custom actions or action creators
    test: true, // Generate tests for the selected actions
  },
);

export const LOG_ONLY_FEATURES: Readonly<DevtoolsFeatureOptions> =
  Object.freeze({
    pause: true,
    export: true,
    test: true,
  });

/**
 * Resolves user options into a complete config, exactly like
 * `createConfig` of `@ngrx/store-devtools`.
 */
export function createConfig<S, A extends Action>(
  optionsInput: DevtoolsOptions<S, A> = {},
): DevtoolsConfig<S, A> {
  const defaults: DevtoolsConfig<S, A> = {
    maxAge: false,
    monitor: noMonitor,
    actionSanitizer: undefined,
    stateSanitizer: undefined,
    actionCreators: undefined,
    name: DEFAULT_NAME,
    serialize: false,
    logOnly: false,
    autoPause: false,
    trace: false,
    traceLimit: 75,
    // Add all features explicitly. This prevents buggy behavior for
    // options like "lock" which might otherwise not show up.
    features: { ...DEFAULT_FEATURES },
    onError: defaultOnError,
  };

  const options =
    typeof optionsInput === "function" ? optionsInput() : optionsInput;
  const features: DevtoolsFeatureOptions = {
    ...(options.features ??
      (options.logOnly ? LOG_ONLY_FEATURES : defaults.features)),
  };
  if (features.import === true) {
    // `import: true` makes the extension import only the raw state (without
    // actions and config), which cannot be replayed. `custom` sends the
    // full lifted state through IMPORT_STATE instead.
    features.import = "custom";
  }

  const config: DevtoolsConfig<S, A> = { ...defaults, ...options, features };

  if (config.maxAge !== false && config.maxAge < 2) {
    throw new Error(
      `Devtools 'maxAge' cannot be less than 2, got ${config.maxAge}`,
    );
  }

  return config;
}
