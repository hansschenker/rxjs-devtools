import type { ActionCreator } from "./types";

/**
 * Feature toggles understood by the Redux DevTools extension.
 *
 * Chrome extension documentation
 * @see https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md#features
 */
export interface DevtoolsFeatureOptions {
  /** Start/pause recording of dispatched actions */
  pause?: boolean;
  /** Lock/unlock dispatching actions and side effects */
  lock?: boolean;
  /** Persist states on page reloading */
  persist?: boolean;
  /** Export history of actions in a file */
  export?: boolean;
  /** Import history of actions from a file */
  import?: "custom" | boolean;
  /** Jump back and forth (time travelling) */
  jump?: boolean;
  /** Skip (cancel) actions */
  skip?: boolean;
  /** Drag and drop actions in the history list */
  reorder?: boolean;
  /** Dispatch custom actions or action creators */
  dispatch?: boolean;
  /** Generate tests for the selected actions */
  test?: boolean;
}

/**
 * Serialization options forwarded to the extension.
 * @see https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md#serialize
 */
export interface SerializationOptions {
  options?: boolean | Record<string, unknown>;
  replacer?: (key: string, value: unknown) => unknown;
  reviver?: (key: string, value: unknown) => unknown;
  immutable?: unknown;
  refs?: unknown[];
}

/**
 * The shape the Redux DevTools extension expects action creators to be in.
 * The extension serializes the entries with `JSON.stringify` (keeping `name`
 * and `args` to render its dispatcher) and refers back to an entry by its
 * index (`selected`) when an action is dispatched from the extension.
 */
export interface ActionCreatorDescriptor {
  name: string;
  func: ActionCreator;
  args: string[];
}

/**
 * Options passed to `extension.connect(...)` and `extension.send(...)`.
 */
export interface ReduxDevtoolsExtensionConfig {
  features?: DevtoolsFeatureOptions | boolean;
  name: string | undefined;
  maxAge?: number;
  autoPause?: boolean;
  serialize?: boolean | SerializationOptions;
  trace?: boolean | (() => string);
  traceLimit?: number;
  actionCreators?: ActionCreatorDescriptor[];
}

/**
 * A message the extension posts back to the page over a connection.
 *
 * - `START` / `STOP`: the monitor was opened / closed.
 * - `DISPATCH`: a history command (`JUMP_TO_STATE`, `TOGGLE_ACTION`, ...),
 *   carried in `payload`.
 * - `ACTION`: an application action typed into the extension's dispatcher,
 *   carried in `payload` as a JavaScript source string or an object.
 */
export interface ExtensionMessage {
  type: string;
  payload?: unknown;
  state?: unknown;
  id?: string | number;
  source?: string;
}

/**
 * A connection returned by `__REDUX_DEVTOOLS_EXTENSION__.connect(...)`.
 */
export interface ReduxDevtoolsExtensionConnection {
  subscribe(listener: (message: ExtensionMessage) => void): unknown;
  unsubscribe(): void;
  send(action: unknown, state: unknown): void;
  init(state?: unknown): void;
  error(message: unknown): void;
}

/**
 * The global installed by the Redux DevTools browser extension.
 */
export interface ReduxDevtoolsExtension {
  connect(
    options: ReduxDevtoolsExtensionConfig,
  ): ReduxDevtoolsExtensionConnection;
  send(
    action: unknown,
    state: unknown,
    options?: ReduxDevtoolsExtensionConfig,
  ): void;
}

export const REDUX_DEVTOOLS_EXTENSION_KEY = "__REDUX_DEVTOOLS_EXTENSION__";

/**
 * Looks the Redux DevTools extension up on the global object.
 *
 * Returns `null` when the extension is not installed, in which case all
 * instrumentation keeps working (time travel is still available
 * programmatically) but nothing is sent anywhere.
 */
export function getReduxDevtoolsExtension(): ReduxDevtoolsExtension | null {
  const host = globalThis as Record<string, unknown>;
  const extension = host[REDUX_DEVTOOLS_EXTENSION_KEY];
  return typeof extension === "object" && extension !== null
    ? (extension as ReduxDevtoolsExtension)
    : null;
}
