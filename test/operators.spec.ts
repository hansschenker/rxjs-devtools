import { describe, expect, it, vi } from "vitest";
import { Subject, from, of, throwError } from "rxjs";

import { PERFORM_ACTION } from "../src/actions";
import { instrumentScan } from "../src/operators";
import type { Action } from "../src/types";
import { createMockDevtools } from "./helpers";

interface CounterAction extends Action {
  readonly type: "INCREMENT" | "DECREMENT";
}

function counter(state: number, action: CounterAction): number {
  return action.type === "INCREMENT" ? state + 1 : state - 1;
}

describe("instrumentScan", () => {
  it("behaves like scan with a seed", () => {
    const values: number[] = [];
    let completed = false;
    from([1, 2, 3])
      .pipe(instrumentScan((acc, value) => acc + value, 0, { extension: null }))
      .subscribe({
        next: (value) => values.push(value),
        complete: () => (completed = true),
      });
    expect(values).toEqual([1, 3, 6]);
    expect(completed).toBe(true);
  });

  it("does not emit the seed and does not hand system actions to the accumulator", () => {
    const accumulator = vi.fn((count: number) => count + 1);
    const values: number[] = [];
    const source = new Subject<void>();
    const subscription = source
      .pipe(instrumentScan(accumulator, 0, { extension: null }))
      .subscribe((value) => values.push(value));
    expect(values).toEqual([]);
    expect(accumulator).not.toHaveBeenCalled();
    source.next();
    source.next();
    expect(values).toEqual([1, 2]);
    expect(accumulator).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("records actions under their own type and wraps other values", () => {
    const mock = createMockDevtools();
    const source = new Subject<CounterAction | number>();
    const values: number[] = [];
    source
      .pipe(
        instrumentScan(
          (state: number, value: CounterAction | number) =>
            typeof value === "number" ? state + value : counter(state, value),
          0,
          { extension: mock.extension },
        ),
      )
      .subscribe((value) => values.push(value));

    source.next({ type: "INCREMENT" });
    source.next(10);

    expect(values).toEqual([1, 11]);
    const sent = mock.connection.send.mock.calls.map(([action]) => action);
    expect(sent).toEqual([
      expect.objectContaining({
        type: PERFORM_ACTION,
        action: { type: "INCREMENT" },
      }),
      expect.objectContaining({
        type: PERFORM_ACTION,
        action: { type: "next", payload: 10 },
      }),
    ]);
  });

  it("supports a custom wrapper action type and round-trips colliding actions", () => {
    const mock = createMockDevtools();
    const source = new Subject<unknown>();
    const seen: unknown[] = [];
    source
      .pipe(
        instrumentScan(
          (state: number, value: unknown) => {
            seen.push(value);
            return state + 1;
          },
          0,
          { extension: mock.extension, actionType: "[ticks] tick" },
        ),
      )
      .subscribe();

    const colliding = { type: "[ticks] tick", n: 1 };
    source.next("a");
    source.next(colliding);

    expect(seen).toEqual(["a", colliding]);
    const sent = mock.connection.send.mock.calls.map(
      ([action]) => (action as { action: Action }).action,
    );
    expect(sent).toEqual([
      { type: "[ticks] tick", payload: "a" },
      { type: "[ticks] tick", payload: colliding },
    ]);
  });

  it("re-emits historical state when the extension time-travels", () => {
    const mock = createMockDevtools();
    const source = new Subject<CounterAction>();
    const values: number[] = [];
    source
      .pipe(instrumentScan(counter, 0, { extension: mock.extension }))
      .subscribe((value) => values.push(value));

    source.next({ type: "INCREMENT" });
    source.next({ type: "INCREMENT" });
    source.next({ type: "DECREMENT" });
    expect(values).toEqual([1, 2, 1]);

    mock.start();
    // Jumping to a state equal to the current one emits nothing new.
    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 1 });
    expect(values).toEqual([1, 2, 1]);

    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 2 });
    expect(values).toEqual([1, 2, 1, 2]);

    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 1 });
    expect(values).toEqual([1, 2, 1, 2, 1]);

    // Skip the DECREMENT and move to the end: 0, 1, 2, (skipped) 2.
    mock.dispatchLifted({ type: "TOGGLE_ACTION", id: 3 });
    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 3 });
    expect(values).toEqual([1, 2, 1, 2, 1, 2]);

    mock.dispatchLifted({ type: "RESET", timestamp: 1 });
    expect(values).toEqual([1, 2, 1, 2, 1, 2, 0]);

    source.next({ type: "INCREMENT" });
    expect(values).toEqual([1, 2, 1, 2, 1, 2, 0, 1]);
  });

  it("records actions dispatched from the extension", () => {
    const mock = createMockDevtools();
    const source = new Subject<CounterAction>();
    const values: number[] = [];
    source
      .pipe(instrumentScan(counter, 0, { extension: mock.extension }))
      .subscribe((value) => values.push(value));

    mock.start();
    mock.dispatchAction("{ type: 'INCREMENT' }");
    expect(values).toEqual([1]);
  });

  it("connects per subscription and disconnects on unsubscribe", () => {
    const mock = createMockDevtools();
    const source = new Subject<number>();
    const instrumented = source.pipe(
      instrumentScan((acc, value) => acc + value, 0, {
        extension: mock.extension,
      }),
    );

    const first = instrumented.subscribe();
    const second = instrumented.subscribe();
    expect(mock.extension.connect).toHaveBeenCalledTimes(2);

    first.unsubscribe();
    expect(mock.connection.unsubscribe).toHaveBeenCalledTimes(1);
    second.unsubscribe();
    expect(mock.connection.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("propagates source errors", () => {
    const error = new Error("boom");
    let seen: unknown;
    throwError(() => error)
      .pipe(instrumentScan((acc: number) => acc + 1, 0, { extension: null }))
      .subscribe({ error: (err) => (seen = err) });
    expect(seen).toBe(error);
  });

  it("accepts options as a function", () => {
    const options = vi.fn(() => ({ extension: null }));
    const values: number[] = [];
    of(1, 2)
      .pipe(instrumentScan((acc, value) => acc + value, 0, options))
      .subscribe((value) => values.push(value));
    expect(options).toHaveBeenCalledTimes(1);
    expect(values).toEqual([1, 3]);
  });
});
