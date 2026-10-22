import { Observable, type MonoTypeOperatorFunction } from "rxjs";

import type { DevtoolsOptions } from "./config";
import { instrument, type InstrumentedStore } from "./devtools";
import type { Action } from "./types";

export type StreamStatus = "active" | "completed" | "errored" | "unsubscribed";

/**
 * What the inspector knows about one named stream. The inspector state is a
 * map of these keyed by stream name, so the extension's state tab shows the
 * latest value of every inspected stream at a glance.
 */
export interface StreamSnapshot {
  readonly status: StreamStatus;
  readonly value?: unknown;
  readonly error?: string;
  readonly emissions: number;
  readonly subscribers: number;
}

export type InspectorState = Readonly<Record<string, StreamSnapshot>>;

export type InspectKind =
  "subscribe" | "next" | "error" | "complete" | "unsubscribe";

/**
 * One notification of an inspected stream, recorded as an action of type
 * `[name] kind`, e.g. `[search$] next`.
 */
export interface InspectAction extends Action {
  readonly stream: string;
  readonly kind: InspectKind;
  readonly value?: unknown;
  readonly error?: string;
}

const INITIAL_SNAPSHOT: StreamSnapshot = {
  status: "unsubscribed",
  emissions: 0,
  subscribers: 0,
};

export function isInspectAction(action: Action): action is InspectAction {
  return (
    typeof (action as InspectAction).stream === "string" &&
    typeof (action as InspectAction).kind === "string"
  );
}

export function inspectAction(
  stream: string,
  kind: InspectKind,
  extra: { value?: unknown; error?: string } = {},
): InspectAction {
  return { type: `[${stream}] ${kind}`, stream, kind, ...extra };
}

export function inspectorReducer(
  state: InspectorState,
  action: Action,
): InspectorState {
  if (!isInspectAction(action)) {
    return state;
  }
  const previous = state[action.stream] ?? INITIAL_SNAPSHOT;
  let next: StreamSnapshot;
  switch (action.kind) {
    case "subscribe":
      next = {
        ...previous,
        status: "active",
        subscribers: previous.subscribers + 1,
      };
      break;
    case "next":
      next = {
        ...previous,
        value: action.value,
        emissions: previous.emissions + 1,
      };
      break;
    case "error":
      next = {
        ...previous,
        status: "errored",
        error: action.error,
        subscribers: Math.max(0, previous.subscribers - 1),
      };
      break;
    case "complete":
      next = {
        ...previous,
        status: "completed",
        subscribers: Math.max(0, previous.subscribers - 1),
      };
      break;
    case "unsubscribe": {
      const subscribers = Math.max(0, previous.subscribers - 1);
      next = {
        ...previous,
        subscribers,
        status: subscribers === 0 ? "unsubscribed" : previous.status,
      };
      break;
    }
  }
  return { ...state, [action.stream]: next };
}

export interface Inspector {
  /**
   * Passes the source through untouched and records its subscribe, next,
   * error, complete and unsubscribe notifications under `name`.
   */
  inspect<T>(name: string): MonoTypeOperatorFunction<T>;
  /** The instrumented store that backs this inspector. */
  readonly store: InstrumentedStore<InspectorState, InspectAction>;
  destroy(): void;
}

export const DEFAULT_INSPECTOR_NAME = "RxJS Inspector";

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

/**
 * Creates an inspector: one Redux DevTools instance that any number of
 * observables can report into. The instance is log-only by default because
 * time travel cannot replay arbitrary streams.
 *
 * ```ts
 * const { inspect } = createInspector({ name: "Search page" });
 * const results$ = query$.pipe(inspect("query$"), switchMap(search), inspect("results$"));
 * ```
 */
export function createInspector(
  options: DevtoolsOptions<InspectorState, InspectAction> = {},
): Inspector {
  const resolved = typeof options === "function" ? options() : options;
  const store = instrument<InspectorState, InspectAction>(
    inspectorReducer,
    {},
    { name: DEFAULT_INSPECTOR_NAME, logOnly: true, ...resolved },
  );

  const inspect = <T>(name: string): MonoTypeOperatorFunction<T> => {
    return (source) =>
      new Observable<T>((subscriber) => {
        let terminated = false;
        store.dispatch(inspectAction(name, "subscribe"));
        const subscription = source.subscribe({
          next: (value) => {
            store.dispatch(inspectAction(name, "next", { value }));
            subscriber.next(value);
          },
          error: (error) => {
            terminated = true;
            store.dispatch(
              inspectAction(name, "error", { error: describeError(error) }),
            );
            subscriber.error(error);
          },
          complete: () => {
            terminated = true;
            store.dispatch(inspectAction(name, "complete"));
            subscriber.complete();
          },
        });
        return () => {
          subscription.unsubscribe();
          if (!terminated) {
            store.dispatch(inspectAction(name, "unsubscribe"));
          }
        };
      });
  };

  return {
    inspect,
    store,
    destroy: () => store.destroy(),
  };
}

let defaultInspector: Inspector | undefined;

/**
 * The shared default inspector, created on first use.
 */
export function getDefaultInspector(): Inspector {
  if (!defaultInspector) {
    defaultInspector = createInspector();
  }
  return defaultInspector;
}

/**
 * Records a stream's notifications in the default inspector instance.
 *
 * ```ts
 * interval(1000).pipe(inspect("tick$")).subscribe();
 * ```
 */
export function inspect<T>(name: string): MonoTypeOperatorFunction<T> {
  return (source) =>
    new Observable<T>((subscriber) =>
      getDefaultInspector().inspect<T>(name)(source).subscribe(subscriber),
    );
}
