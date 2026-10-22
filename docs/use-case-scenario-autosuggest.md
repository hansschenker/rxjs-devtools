# Use case: an autosuggest pipeline under RxJS DevTools

This guide walks through the "Search" section of the demo (`npm run demo`),
a classic typeahead, and shows how to read and test it with the RxJS DevTools
panel or the Redux DevTools extension. The same steps apply to any
autosuggest built from `debounceTime`, `distinctUntilChanged` and
`switchMap`.

## The sample

From `demo/main.ts`, slightly condensed:

```ts
import { createInspector } from "@hansschenker/rxjs-devtools";

const { inspect } = createInspector({ name: "Search" });

fromEvent(input, "input")
  .pipe(
    map(() => input.value.trim()),
    inspect("query$"), // every keystroke
    debounceTime(300),
    distinctUntilChanged(),
    inspect("debounced$"), // what survives debounce and distinct
    switchMap(search), // simulated request, 250 ms, cancelled by new input
    inspect("results$"), // what reaches the screen
  )
  .subscribe(render);

function search(query: string) {
  const hits = OPERATORS.filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  return query ? timer(250).pipe(map(() => hits)) : of([]);
}
```

### How the devtools are wired in

- `createInspector({ name: "Search" })` creates one instrumented store that
  appears as the instance "Search" in the panel and in the extension.
- `inspect(name)` is a pass-through operator. It records every notification
  of the stream it sits on as an action: `[query$] subscribe`,
  `[query$] next`, `[results$] error`, `[debounced$] unsubscribe` and so on.
  The value of a `next` is stored on the action.
- The store's state is a map of stream name to a snapshot: latest `value`,
  `status` (`active`, `completed`, `errored`, `unsubscribed`), `emissions`
  and `subscribers`.
- The inspector is log-only on purpose. A live keystroke stream cannot be
  replayed, so the Search instance shows no Jump, Skip or slider, only
  Pause, Export and the history commands.

## Where to look

Open the panel (the section at the bottom of the demo page, or its
"Pop out window" button) and pick the **Search** instance. In the Redux
DevTools extension choose the same instance from its dropdown.

- **Action list.** The order of notifications across all three taps, newest
  at the bottom, with the time gap to the previous row. The gaps are where
  `debounceTime` becomes visible.
- **State tab** on the newest row. All three streams side by side;
  `emissions` counts how many values passed each tap.
- **Diff tab.** What one notification changed, for example
  `results$.value` going from five hits to two.
- **Action tab.** The raw action, including the emitted value.

## Scenarios

### 1. Debounce collapsing keystrokes

Type `map` quickly.

Expected: three `[query$] next` rows (`m`, `ma`, `map`), then after a gap of
about 300 ms one `[debounced$] next` with `map`, then about 250 ms later one
`[results$] next` with five hits. In State, `query$.emissions` is 3 and
`debounced$.emissions` is 1.

### 2. distinctUntilChanged

Type `map`, wait a second, add `s`, then delete it again within 300 ms.

Expected: `query$` records `maps` and `map`, but no new `debounced$` row
appears because the debounced value did not change. `results$` stays as it
was.

### 3. Clearing the input

Select all and delete.

Expected: `debounced$` emits an empty string, `search` returns `of([])`,
`results$` emits an empty array and the page shows "(no results)".

### 4. The ratio

Type a longer word such as `distinct`, then compare `query$.emissions` to
`results$.emissions` in the State tab. That ratio is the work `debounceTime`
saved.

### 5. switchMap cancellation (needs a tweak)

With the shipped timings a request always finishes before the next debounced
value can arrive (250 ms request, 300 ms debounce), so cancellation never
shows. Two changes make it visible:

```ts
// 1. a slower fake request
return query ? timer(1500).pipe(map(() => hits)) : of([]);

// 2. a tap inside the switchMap, on the request itself
switchMap((q) => search(q).pipe(inspect("request$"))),
```

Now type `sc`, pause half a second, then type `an`.

Expected: `[request$] subscribe` for `sc`, then `[request$] unsubscribe`
the moment `scan` is debounced (that is the cancellation), a new
`[request$] subscribe`, and only one `[request$] next` and one
`[results$] next`, both for `scan`. In State, `request$.subscribers` is
never above 1.

### 6. Error propagation (needs a tweak)

Make the request fail for one query:

```ts
function search(query: string) {
  if (query === "boom") throw new Error("boom");
  // ...
}
```

Type `boom`.

Expected: `[results$] error` with the message `Error: boom`, followed by
`[debounced$] unsubscribe` and `[query$] unsubscribe` as the chain tears
down, and the input stops producing rows. In State, `results$.status` is
`errored` and every `subscribers` count is 0.

Then add a `catchError` inside the switchMap:

```ts
switchMap((q) => search(q).pipe(catchError(() => of([])))),
```

Type `boom` again.

Expected: `results$` emits an empty array, nothing is unsubscribed, and the
next keystroke keeps producing rows. The subscriber counts in State tell the
two cases apart at a glance.

### 7. Pause and export

Press Pause in the panel, type a few queries, press Resume. While paused the
page works but no rows are added; Resume commits the paused stretch. Press
Export to save the whole log as JSON, useful for attaching to a bug report.

## Using it in your own autosuggest

For a pipeline like the one above, `createInspector` plus `inspect` between
the operators you care about is the whole setup:

```ts
const { inspect } = createInspector({ name: "Autosuggest" });

const suggestions$ = keystrokes$.pipe(
  inspect("keystrokes$"),
  debounceTime(300),
  distinctUntilChanged(),
  inspect("query$"),
  switchMap((q) => api.suggest(q).pipe(inspect("request$"))),
  inspect("suggestions$"),
);
```

If the suggest box is modelled as state instead, for example a `scan` that
folds a union of events into `{ query, loading, results }`, swap that `scan`
for `instrumentScan` and the instance gains the full time-travel set over the
user's keystrokes: jump back to the state after a given key, skip a keystroke,
or export a session and import it later to reproduce a bug.

```ts
const state$ = events$.pipe(
  instrumentScan(suggestReducer, initialState, { name: "Autosuggest state" }),
  shareReplay(1),
);
```

The two combine well: `instrumentScan` for the state, `inspect` on the request
stream that feeds it.

## Tips

- Row buttons appear on hover. Click a row to pin the Action, State and Diff
  tabs to it.
- Each subscription of an `instrumentScan` pipeline gets its own history and
  instance; use `share()` or `shareReplay(1)` after it when several
  subscribers share one stream.
- `inspect` stores whatever the stream emits. For large payloads or DOM
  events, map to a compact value before the tap or pass a `stateSanitizer`
  to `createInspector`.
