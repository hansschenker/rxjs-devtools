import {
  Subscription,
  debounceTime,
  distinctUntilChanged,
  fromEvent,
  interval,
  map,
  of,
  switchMap,
  timer,
} from "rxjs";

import { createInspector, instrument, instrumentScan } from "../src/index";
import { createDevtoolsPanel } from "../src/panel/index";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

// --- The built-in RxJS DevTools panel ---------------------------------------
// Every store below is attached to it; the Redux DevTools extension, when
// installed, receives the same history in parallel.

const panel = createDevtoolsPanel({ container: byId("panel") });
byId("popout").onclick = () => {
  if (!panel.popOut()) {
    byId("popout-hint").textContent =
      "The popup was blocked. Allow popups for this page and try again.";
  }
};

// --- 1. instrument(): a reducer-driven store with full time travel -------

interface CounterState {
  readonly count: number;
  readonly dispatched: number;
}

type CounterAction =
  | { type: "[Counter] Increment" }
  | { type: "[Counter] Decrement" }
  | { type: "[Counter] Reset" };

function counterReducer(
  state: CounterState,
  action: CounterAction,
): CounterState {
  switch (action.type) {
    case "[Counter] Increment":
      return { count: state.count + 1, dispatched: state.dispatched + 1 };
    case "[Counter] Decrement":
      return { count: state.count - 1, dispatched: state.dispatched + 1 };
    case "[Counter] Reset":
      return { count: 0, dispatched: state.dispatched + 1 };
    default:
      // System actions (init, update-reducer, recompute) land here.
      return state;
  }
}

const counter = instrument<CounterState, CounterAction>(
  counterReducer,
  { count: 0, dispatched: 0 },
  {
    name: "Counter",
    maxAge: 50,
    actionCreators: {
      increment: () => ({ type: "[Counter] Increment" }),
      decrement: () => ({ type: "[Counter] Decrement" }),
    },
  },
);
panel.attach("Counter", counter);

counter.state$.subscribe((state) => {
  byId("count").textContent = String(state.count);
  byId("count-actions").textContent = String(state.dispatched);
});

byId("increment").onclick = () =>
  counter.dispatch({ type: "[Counter] Increment" });
byId("decrement").onclick = () =>
  counter.dispatch({ type: "[Counter] Decrement" });
byId("reset-counter").onclick = () =>
  counter.dispatch({ type: "[Counter] Reset" });
byId("commit").onclick = () => counter.devtools.commit();
byId("rollback").onclick = () => counter.devtools.rollback();

// --- 2. instrumentScan(): drop-in for scan on any observable --------------

const ticks$ = interval(1000).pipe(
  instrumentScan((ticks: number) => ticks + 1, 0, {
    name: "Ticker",
    maxAge: 100,
    actionType: "[Ticker] tick",
    // The panel detaches the store again when the subscription ends.
    onStore: (store) => panel.attach("Ticker", store),
  }),
);

let ticker: Subscription | undefined;
const toggle = byId<HTMLButtonElement>("toggle-ticker");
toggle.onclick = () => {
  if (ticker) {
    ticker.unsubscribe();
    ticker = undefined;
    toggle.textContent = "start";
    return;
  }
  ticker = ticks$.subscribe((ticks) => {
    byId("ticks").textContent = String(ticks);
  });
  toggle.textContent = "stop";
};

// --- 3. inspect(): log any stream's notifications --------------------------

const OPERATORS = [
  "map",
  "mergeMap",
  "switchMap",
  "concatMap",
  "exhaustMap",
  "scan",
  "reduce",
  "filter",
  "take",
  "takeUntil",
  "debounceTime",
  "distinctUntilChanged",
  "combineLatest",
  "withLatestFrom",
  "share",
  "shareReplay",
];

function search(query: string) {
  const hits = OPERATORS.filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  // Simulate a request.
  return query ? timer(250).pipe(map(() => hits)) : of([]);
}

const inspector = createInspector({ name: "Search" });
const { inspect } = inspector;
panel.attach("Search", inspector.store);

const input = byId<HTMLInputElement>("query");
fromEvent(input, "input")
  .pipe(
    map(() => input.value.trim()),
    inspect("query$"),
    debounceTime(300),
    distinctUntilChanged(),
    inspect("debounced$"),
    switchMap(search),
    inspect("results$"),
  )
  .subscribe((results) => {
    byId("results").textContent = results.length
      ? results.join("\n")
      : "(no results)";
  });

// Expose the store and the panel for poking around in the console.
declare global {
  interface Window {
    counter: typeof counter;
    panel: typeof panel;
  }
}
window.counter = counter;
window.panel = panel;
