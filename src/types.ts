/**
 * The minimal action contract shared by every entry point of this library.
 *
 * Mirrors `Action` from `@ngrx/store`: anything with a string `type` is an
 * action. The Redux DevTools extension renders the `type` in its log monitor
 * and uses it for action filtering.
 */
export interface Action<Type extends string = string> {
  readonly type: Type;
}

/**
 * A pure function `(state, action) => nextState`.
 *
 * Reducers handed to `instrument` must return the given state unchanged for
 * action types they do not know. Besides your own actions they receive the
 * library's system actions (`INIT`, `UPDATE`, `RECOMPUTE`) exactly like an
 * `@ngrx/store` reducer does.
 */
export type ActionReducer<S, A extends Action = Action> = (
  state: S,
  action: A,
) => S;

/**
 * A function returning an action. When configured through
 * `actionCreators`, the Redux DevTools dispatcher lists these creators and lets
 * you dispatch them with hand-typed arguments.
 *
 * An optional `type` property (like the one `createAction` of `@ngrx/store`
 * provides) is used as the display name in the extension.
 */
export type ActionCreator = ((...args: never[]) => Action) & {
  readonly type?: string;
};

/**
 * Type guard for the `Action` contract.
 */
export function isAction(value: unknown): value is Action {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
