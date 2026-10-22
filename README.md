# rxjs-devtools

Redux DevTools time travel for RxJS. Swap `scan` for `instrumentScan` and the
browser extension shows every value that went into your state, lets you skip
any of them, jump back and forth, commit, roll back, export and import, while
your pipeline keeps running.

```ts
import { instrumentScan } from "@hansschenker/rxjs-devtools";

const count$ = clicks$.pipe(instrumentScan((count) => count + 1, 0));

const todos$ = actions$.pipe(
  instrumentScan(todosReducer, initialTodos, { name: "Todos", maxAge: 100 }),
);
```

```
npm install @hansschenker/rxjs-devtools rxjs
```

Install the
[Redux DevTools](https://github.com/reduxjs/redux-devtools/tree/main/extension#installation)
browser extension to see anything; without it the instrumentation still works
(time travel is available programmatically through `onStore`) but nothing is
sent anywhere.

The history machinery is a framework-less port of
[`@ngrx/store-devtools`](https://github.com/ngrx/platform/tree/main/modules/store-devtools):
the lifted-state reducer, the filtering and sanitizing logic and the extension
protocol are the same, but there is no Angular, no NgRx store and no
dependency injection. Everything is a function over observables.

## `instrumentScan`

```ts
instrumentScan<T, S>(
  accumulator: (state: S, value: T) => S,
  seed: S,
  options?: InstrumentScanOptions<S> | (() => InstrumentScanOptions<S>),
): OperatorFunction<T, S>;
```

### The `scan` contract stays

Like `scan` with a seed, nothing is emitted until the first source value, and
every source value produces exactly one emission. Completion and errors of the
source pass straight through. Replacing `scan` with `instrumentScan` in a dev
build changes nothing about what your subscribers see until someone touches
the extension.

### Time travel adds emissions

Jumping, skipping, rolling back or importing in the extension recomputes the
history and emits the state at the new position downstream, so whatever renders
from `count$` follows along. Side effects downstream of the operator therefore
re-run on time travel, which is the point but worth knowing. A devtools command
that lands on a state identical to the current one emits nothing.

### Any value is an action

Source values that are actions (objects with a string `type`) are recorded
under their own type and reach the accumulator unchanged. Anything else, a
number, a DOM event payload, a string, is shown as
`{ type: "next", payload: value }` and unwrapped before the accumulator sees
it. `actionType` renames the wrapper, for example `"[Ticker] tick"`.

The accumulator never sees the library's system actions (`init`,
`update-reducer`, `recompute`), so `(count) => count + 1` is a valid
accumulator.

### One history per subscription

Each subscription creates its own history and its own extension instance under
the configured `name`. When several subscribers share one stream, put `share()`
or `shareReplay(1)` after the operator:

```ts
const state$ = actions$.pipe(instrumentScan(reducer, initial), shareReplay(1));
```

The history grows by one entry per value and recomputation after a skip is
linear in its length, so give high-frequency sources a `maxAge`.

### `onStore`: time travel without the extension

The operator hides the store it creates. `onStore` hands it to you once per
subscription, right before the source is subscribed:

```ts
let devtools: DevtoolsController<number, Action> | undefined;

const count$ = clicks$.pipe(
  instrumentScan((count) => count + 1, 0, {
    onStore: (store) => (devtools = store.devtools),
  }),
);

devtools?.jumpToState(0); // count$ re-emits the seed state
devtools?.toggleAction(2); // skip the second click, count$ re-emits
```

The store exposes `devtools` (every history command), `liftedState$`,
`getLiftedState()`, `getState()`, `replaceReducer()` and `config`. It is
destroyed when the subscription ends. In tests, combine `onStore` with
`extension: null`.

## The RxJS DevTools panel

The browser extension is optional. `@hansschenker/rxjs-devtools/panel` ships a
monitor of its own that reads `liftedState$` and drives `store.devtools`, so
it shows the same history with the same commands, under its own name and
icon, inline in your page or in a separate window titled "RxJS DevTools".

```ts
import {
  createDevtoolsPanel,
  openDevtoolsWindow,
} from "@hansschenker/rxjs-devtools/panel";

const panel = createDevtoolsPanel({
  container: document.querySelector<HTMLElement>("#devtools")!,
});
panel.attach("Counter", store);

const ticks$ = interval(1000).pipe(
  instrumentScan((n) => n + 1, 0, {
    onStore: (s) => panel.attach("Ticker", s),
  }),
);

button.onclick = () => panel.popOut(); // or openDevtoolsWindow()
```

The panel has an action list with Jump and Skip per row and a type filter,
Action, State and Diff tabs for the selected entry, Commit, Revert, Sweep,
Reset, Pause and Lock, Export and Import of the history as JSON, a slider
with Prev, Play and Next, and an instance dropdown once more than one store is
attached. A store detaches itself when it is destroyed, which is what makes
`onStore` a one-liner above.

`openDevtoolsWindow()` has to run from a user gesture because of popup
blockers and returns `null` when blocked; calling it again focuses the open
window. The panel is framework-free DOM code with no runtime dependency on the
core entry point. Styles are injected once per document and follow
`prefers-color-scheme`.

## Also included

### `instrument`: the store form

When you start from a reducer rather than from an existing pipeline,
`instrument` bundles the dispatch subject with the same instrumentation.
`actions$.pipe(instrumentScan(reducer, initial))` and
`instrument(reducer, initial)` behave identically.

```ts
import { instrument } from "@hansschenker/rxjs-devtools";

const store = instrument(counter, 0, { name: "Counter", maxAge: 50 });

store.state$.subscribe(render);
store.dispatch({ type: "INCREMENT" });

store.devtools.jumpToState(0);
store.devtools.toggleAction(1);
store.devtools.commit();
store.replaceReducer(nextCounter); // hot reload, history is recomputed
store.destroy();
```

`state$` replays the latest state to new subscribers, emits once per
dispatched action and whenever a devtools command changes the current state.
`actions$` emits each application action after it has been reduced, including
actions dispatched from the extension's own dispatcher UI. Unlike an
`instrumentScan` accumulator, a reducer given to `instrument` receives the
system actions, exactly like an `@ngrx/store` reducer, and must return its
state unchanged for unknown types.

### `inspect`: log any stream

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

Every value is _lifted_ into a `PERFORM_ACTION` and appended to a history; the
accumulator is lifted into a reducer over that history. This is the
`LiftedState` the Redux DevTools extension understands:

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
source values ────┐
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
- `maxAge` auto-commits the oldest actions; errors thrown by the accumulator
  are recorded on the computed state (and reported to `onError`) instead of
  breaking the stream.
- `predicate`, `actionsSafelist` and `actionsBlocklist` keep actions out of the
  history and the extension while the state still updates.

Every control in the extension maps to one message the page already handles:

| UI control                   | Message                                | Handled in         |
| ---------------------------- | -------------------------------------- | ------------------ |
| Jump, slider                 | `JUMP_TO_STATE` / `JUMP_TO_ACTION`     | `src/reducer.ts`   |
| Skip                         | `TOGGLE_ACTION`                        | `src/reducer.ts`   |
| Commit, Revert, Reset, Sweep | `COMMIT`, `ROLLBACK`, `RESET`, `SWEEP` | `src/reducer.ts`   |
| Pause, Lock                  | `PAUSE_RECORDING`, `LOCK_CHANGES`      | `src/reducer.ts`   |
| Import, persist on reload    | `IMPORT_STATE`                         | `src/reducer.ts`   |
| Dispatcher                   | `ACTION` with a source string          | `src/extension.ts` |

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
| `onError`          | `console.error`   | Called with errors thrown by your accumulator or reducer              |

`instrumentScan` adds two of its own:

| Option       | Default  | Purpose                                         |
| ------------ | -------- | ----------------------------------------------- |
| `actionType` | `"next"` | Type used to wrap non-action source values      |
| `onStore`    |          | Receives the backing store of each subscription |

## Mapping from `@ngrx/store-devtools`

| `@ngrx/store-devtools`                                             | `rxjs-devtools`                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `provideStoreDevtools(options)` / `StoreDevtoolsModule.instrument` | `instrumentScan(reducer, initialState, options)` or `instrument(...)` |
| `Store.dispatch` / `Store` state                                   | the source observable / the operator output                           |
| `ScannedActionsSubject`                                            | `store.actions$`                                                      |
| `StoreDevtools.liftedState`                                        | `store.liftedState$`                                                  |
| `StoreDevtools.jumpToState(...)`, `commit()`, ...                  | `store.devtools.jumpToState(...)`, `commit()`, ...                    |
| `ReducerManager.addReducer` (`UPDATE`)                             | `store.replaceReducer(reducer)`                                       |
| `ErrorHandler`                                                     | `onError` option (defaults to `console.error`)                        |
| `REDUX_DEVTOOLS_EXTENSION` token                                   | `extension` option (defaults to the global, `null` disables)          |
| `connectInZone`                                                    | not needed                                                            |
| `@ngrx/store/init`, `update-reducers`, `recompute`                 | `@rxjs-devtools/init`, `update-reducer`, `recompute`                  |
| `liftReducerWith`, `LiftedState`, `unliftState`                    | exported under the same names                                         |

Two behaviours differ on purpose: the `predicate` always receives the plain
state (NgRx hands it the `{ state, error }` wrapper in one code path), and the
one-second wait for lazily registered reducers before `IMPORT_STATE` is gone
because there is no reducer manager.

## Testing

Pass `extension: null` and drive the history through the store:

```ts
let store!: InstrumentedStore<number, Action>;
const values: number[] = [];

actions$
  .pipe(
    instrumentScan(counter, 0, {
      extension: null,
      onStore: (s) => (store = s),
    }),
  )
  .subscribe((value) => values.push(value));

actions$.next({ type: "INCREMENT" });
store.devtools.toggleAction(1);
expect(values).toEqual([1, 0]);
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
