import { Observable, skip, type OperatorFunction } from "rxjs";

import type { DevtoolsConfig } from "./config";
import { instrument, type InstrumentedStore } from "./devtools";
import { isSystemAction } from "./reducer";
import { isAction, type Action, type ActionReducer } from "./types";

/**
 * Wrapper for source values that are not actions themselves, so they can be
 * shown (and filtered) in the extension by type.
 */
export interface ValueAction<T = unknown> extends Action {
  readonly payload: T;
}

export const DEFAULT_VALUE_ACTION_TYPE = "next";

export interface InstrumentScanOptions<S = unknown> extends Partial<
  DevtoolsConfig<S, Action>
> {
  /**
   * Action type used to wrap source values that are not actions (objects
   * with a string `type`). Defaults to `"next"`. Source actions that happen
   * to carry this type are wrapped as well, so unwrapping stays unambiguous.
   */
  actionType?: string;
  /**
   * Called once per subscription with the instrumented store that backs it,
   * before the source is subscribed. Use it to reach `store.devtools` for
   * programmatic time travel (also without the extension), `liftedState$`,
   * or `replaceReducer`. The store is destroyed when the subscription ends.
   */
  onStore?: (store: InstrumentedStore<S, Action>) => void;
}

/**
 * A drop-in replacement for `scan` that records every source value as an
 * action in the Redux DevTools extension and supports time travel: jumping,
 * skipping and rolling back in the extension re-emits the corresponding
 * historical state downstream.
 *
 * Like `scan` with a seed, the seed itself is not emitted; the first emission
 * follows the first source value.
 *
 * Unlike a reducer given to `instrument`, the accumulator never sees the
 * library's system actions. Any value works as input: values that are not
 * actions are wrapped as `{ type: "next", payload: value }` for display and
 * unwrapped again before they reach the accumulator.
 *
 * Each subscription gets its own history and its own extension instance;
 * put `share()` after the operator when several subscribers share one stream.
 *
 * ```ts
 * const count$ = clicks$.pipe(instrumentScan((count) => count + 1, 0));
 * const todos$ = actions$.pipe(instrumentScan(todosReducer, [], { name: "Todos" }));
 * ```
 */
export function instrumentScan<T, S>(
  accumulator: (state: S, value: T) => S,
  seed: S,
  options: InstrumentScanOptions<S> | (() => InstrumentScanOptions<S>) = {},
): OperatorFunction<T, S> {
  return (source) =>
    new Observable<S>((subscriber) => {
      const resolved = typeof options === "function" ? options() : options;
      const {
        actionType = DEFAULT_VALUE_ACTION_TYPE,
        onStore,
        ...devtoolsOptions
      } = resolved;

      const toAction = (value: T): Action => {
        if (isAction(value) && value.type !== actionType) {
          return value;
        }
        const wrapped: ValueAction<T> = { type: actionType, payload: value };
        return wrapped;
      };

      const fromAction = (action: Action): T =>
        action.type === actionType && "payload" in action
          ? (action as ValueAction<T>).payload
          : (action as unknown as T);

      const reducer: ActionReducer<S, Action> = (state, action) =>
        isSystemAction(action) ? state : accumulator(state, fromAction(action));

      const store = instrument<S, Action>(reducer, seed, devtoolsOptions);

      const subscription = store.state$.pipe(skip(1)).subscribe({
        next: (state) => subscriber.next(state),
        error: (error) => subscriber.error(error),
      });
      // The output is wired up, so anything `onStore` does to the history
      // (a jump, an import) already reaches the subscriber.
      onStore?.(store);
      subscription.add(
        source.subscribe({
          next: (value) => store.dispatch(toAction(value)),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      );
      subscription.add(() => store.destroy());
      return subscription;
    });
}
