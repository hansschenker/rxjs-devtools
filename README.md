# rxjs-devtools

Redux DevTools instrumentation for RxJS. Time travel, action skipping,
commit/rollback, import/export and live stream inspection for
`scan`-based state and for any observable.

It is a framework-less port of the lifted-state architecture of
[`@ngrx/store-devtools`](https://github.com/ngrx/platform/tree/main/modules/store-devtools):
the history reducer, the filtering and sanitizing logic and the extension
protocol are the same, but there is no Angular, no NgRx store and no
dependency injection. Everything is a function over observables.

```
npm install @hansschenker/rxjs-devtools rxjs
```

Install the
[Redux DevTools](https://github.com/reduxjs/redux-devtools/tree/main/extension#installation)
browser extension to see anything; without it the instrumentation still works
(time travel is available programmatically) but nothing is sent anywhere.

## Three entry points

| You have                                        | Use                                          | What you get                                                          |
| ----------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| A reducer and an initial state                  | `instrument(reducer, initialState, options)` | A store with `dispatch`, `state$`, `actions$` and full time travel    |
| An existing `actions$.pipe(scan(...))` pipeline | `instrumentScan(accumulator, seed, options)` | A drop-in for `scan` whose output follows the extension's time travel |
| Any observable you want to look at              | `inspect(name)` / `createInspector(options)` | Every notification logged as an action, latest values in the state    |

### `instrument`

```ts
import { instrument } from "@hansschenker/rxjs-devtools";

type Action = { type: "INCREMENT" } | { type: "DECREMENT" };

function counter(state: number, action: Action): number {
  switch (action.type) {
    case "INCREMENT":
      return state + 1;
    case "DECREMENT":
      return state - 1;
    default:
      return state; // system actions land here
  }
}

const store = instrument(counter, 0, { name: "Counter", maxAge: 50 });

store.state$.subscribe(render);
store.dispatch({ type: "INCREMENT" });

// The same commands the extension issues, available in code:
store.devtools.jumpToState(0);
store.devtools.toggleAction(1);
store.devtools.commit();
store.replaceReducer(nextCounter); // hot reload, history is recomputed
store.destroy();
```

`state$` replays the latest state to new subscribers, emits once per
dispatched action and whenever a devtools command changes the current state.
`actions$` emits each application action after it has been reduced, including
actions dispatched from the extension's own dispatcher UI.

### `instrumentScan`

```ts
import { instrumentScan } from "@hansschenker/rxjs-devtools";

const count$ = clicks$.pipe(instrumentScan((count) => count + 1, 0));

const todos$ = actions$.pipe(
  instrumentScan(todosReducer, initialTodos, { name: "Todos" }),
);
```

Like `scan` with a seed, nothing is emitted until the first source value. When
you jump, skip or roll back in the extension, the corresponding historical
state is emitted downstream. Source values that are not actions (no string
`type`) are shown as `{ type: "next", payload: value }` and unwrapped before
they reach your accumulator. The accumulator never sees system actions.

### `inspect`

```ts
import { createInspector } from "@hansschenker/rxjs-devtools";

const { inspect } = createInspector({ name: "Search page" });

const results$ = query$.pipe(
  inspect("query$"),
  debounceTime(300),
  inspect("debounced$"),
  switchMap(search),
  inspect("results$"),
);
```

`inspect` passes values through untouched and records `subscribe`, `next`,
`error`, `complete` and `unsubscribe` as actions named `[query$] next` and so
on. The instance state is a map of stream name to its latest value, status,
emission and subscriber counts, so the extension's state tab shows every
inspected stream at a glance. A module-level `inspect` bound to a shared
default instance is exported as well. Inspector instances are log-only by
default because arbitrary streams cannot be replayed.

## How it works

Every application action is _lifted_ into a `PERFORM_ACTION` and appended to a
history; the application reducer is lifted into a reducer over that history.
This is the `LiftedState` the Redux DevTools extension understands:

```ts
interface LiftedState<S, A> {
  actionsById: {
    [id: number]: { type: "PERFORM_ACTION"; action: A; timestamp: number };
  };
  stagedActionIds: number[]; // order of the history, 0 is INIT
  skippedActionIds: number[]; // toggled off in the UI
  computedStates: { state: S; error?: string }[]; // one per staged action
  currentStateIndex: number; // where the time-travel pointer is
  committedState: S; // base state the history is replayed from
  nextActionId: number;
  isLocked: boolean;
  isPaused: boolean;
  monitorState: unknown;
}
```

```
dispatch(action) ─┐
extension ACTION ─┴─ liftAction ─┐
devtools commands ───────────────┼─ merge ─ observeOn(queue) ─ withLatestFrom(liftedReducer$) ─ scan ─┬─ liftedState$
extension DISPATCH ──────────────┘                                                                    ├─ state$ = unliftState
                                                                                                      └─ notify(extension)
```

- `PERFORM_ACTION` is the hot path: only the new action and the new state are
  sent to the extension and only that one state is computed.
- Every other lifted action (jump, skip, commit, reducer replacement, ...) may
  invalidate history, so the affected states are recomputed and the whole
  lifted state is sent.
- `maxAge` auto-commits the oldest actions; errors thrown by the reducer are
  recorded on the computed state (and reported to `onError`) instead of
  breaking the stream.
- `predicate`, `actionsSafelist` and `actionsBlocklist` keep actions out of the
  history and the extension while the application state still updates.

## Mapping from `@ngrx/store-devtools`

| `@ngrx/store-devtools`                                             | `rxjs-devtools`                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `provideStoreDevtools(options)` / `StoreDevtoolsModule.instrument` | `instrument(reducer, initialState, options)`                 |
| `Store.dispatch` / `Store` state                                   | `store.dispatch` / `store.state$`                            |
| `ScannedActionsSubject`                                            | `store.actions$`                                             |
| `StoreDevtools.liftedState`                                        | `store.liftedState$`                                         |
| `StoreDevtools.jumpToState(...)`, `commit()`, ...                  | `store.devtools.jumpToState(...)`, `commit()`, ...           |
| `ReducerManager.addReducer` (`UPDATE`)                             | `store.replaceReducer(reducer)`                              |
| `ErrorHandler`                                                     | `onError` option (defaults to `console.error`)               |
| `REDUX_DEVTOOLS_EXTENSION` token                                   | `extension` option (defaults to the global, `null` disables) |
| `connectInZone`                                                    | not needed                                                   |
| `@ngrx/store/init`, `update-reducers`, `recompute`                 | `@rxjs-devtools/init`, `update-reducer`, `recompute`         |
| `liftReducerWith`, `LiftedState`, `unliftState`                    | exported under the same names                                |

## Options

All options are optional and can also be given as a function returning them.

| Option             | Default           | Purpose                                                               |
| ------------------ | ----------------- | --------------------------------------------------------------------- |
| `name`             | `"RxJS DevTools"` | Instance name in the extension's dropdown                             |
| `maxAge`           | `false`           | Maximum history length; oldest actions are auto-committed (minimum 2) |
| `logOnly`          | `false`           | Restrict the extension to pause, export and test                      |
| `features`         | all enabled       | Fine-grained feature toggles                                          |
| `actionSanitizer`  |                   | `(action, id) => action` before sending to the extension              |
| `stateSanitizer`   |                   | `(state, index) => state` before sending to the extension             |
| `predicate`        |                   | `(state, action) => boolean`, `false` keeps the action out of history |
| `actionsSafelist`  |                   | Only record action types matching these                               |
| `actionsBlocklist` |                   | Never record action types matching these (ignored with a safelist)    |
| `actionCreators`   |                   | Creators offered in the extension's dispatcher UI                     |
| `serialize`        | `false`           | Serialization options forwarded to the extension                      |
| `autoPause`        | `false`           | Pause recording while the extension window is closed                  |
| `trace`            | `false`           | Record stack traces per action                                        |
| `traceLimit`       | `75`              | Maximum stack frames per trace                                        |
| `monitor`          | no state          | Reducer for custom monitor state                                      |
| `extension`        | global            | Extension to connect to; `null` disconnects (handy in tests)          |
| `onError`          | `console.error`   | Called with errors thrown by your reducer                             |

`instrumentScan` additionally accepts `actionType` (default `"next"`), the
type used to wrap non-action source values.

## Testing

Pass `extension: null` and drive the history through `store.devtools`:

```ts
const store = instrument(counter, 0, { extension: null });
store.dispatch({ type: "INCREMENT" });
store.devtools.toggleAction(1);
expect(store.getState()).toBe(0);
```

To test the extension protocol, pass a fake extension object with `connect`
and `send`; see `test/helpers.ts` for one.

## Development

```
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsup -> dist/ (ESM + CJS + d.ts)
npm run demo      # vite dev server with the demo page
```

The test suite ports the `@ngrx/store-devtools` specs (history reducer,
extension bridge, filtering, maxAge, import, lock, pause) and adds coverage
for the RxJS-specific entry points.

## Credits

The history reducer and extension bridge follow `@ngrx/store-devtools`
(MIT, NgRx contributors), which in turn derives from
`redux-devtools-instrument` (MIT, Dan Abramov and contributors).

## License

MIT
