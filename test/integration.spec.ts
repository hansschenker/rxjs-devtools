import { describe, expect, it } from "vitest";

import { PERFORM_ACTION } from "../src/actions";
import { DEFAULT_FEATURES, type DevtoolsConfig } from "../src/config";
import { instrument } from "../src/devtools";
import type { LiftedState } from "../src/reducer";
import type { Action } from "../src/types";
import { counter, createMockDevtools } from "./helpers";

describe("instrument with the Redux DevTools extension", () => {
  it("connects on creation and inits the connection", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, {
      extension: mock.extension,
      name: "Counter",
    });

    expect(mock.extension.connect).toHaveBeenCalledTimes(1);
    expect(mock.extension.connect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Counter", features: DEFAULT_FEATURES }),
    );
    expect(mock.connection.init).toHaveBeenCalledTimes(1);
    store.destroy();
    expect(mock.connection.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("picks the extension up from the global object by default", () => {
    const mock = createMockDevtools();
    const host = globalThis as Record<string, unknown>;
    host.__REDUX_DEVTOOLS_EXTENSION__ = mock.extension;
    try {
      const store = instrument(counter, 0);
      expect(mock.extension.connect).toHaveBeenCalledTimes(1);
      store.destroy();
    } finally {
      delete host.__REDUX_DEVTOOLS_EXTENSION__;
    }
  });

  it("sends the full history when the monitor starts and a fast update per action", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });

    expect(mock.extension.send).toHaveBeenCalledTimes(1); // INIT
    mock.start();
    expect(mock.extension.send).toHaveBeenCalledTimes(2); // REFRESH
    const [action, liftedState] = mock.extension.send.mock.lastCall as [
      unknown,
      LiftedState<number, Action>,
    ];
    expect(action).toBeNull();
    expect(liftedState.computedStates).toEqual([{ state: 0 }]);

    store.dispatch({ type: "INCREMENT" });
    expect(mock.connection.send).toHaveBeenCalledTimes(1);
    expect(mock.connection.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: PERFORM_ACTION,
        action: { type: "INCREMENT" },
      }),
      1,
    );
    store.destroy();
  });

  it("time-travels when the extension says so", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });
    const states: number[] = [];
    store.state$.subscribe((state) => states.push(state));

    store.dispatch({ type: "INCREMENT" });
    store.dispatch({ type: "INCREMENT" });
    mock.start();

    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 1 });
    expect(store.getState()).toBe(1);

    mock.dispatchLifted({ type: "TOGGLE_ACTION", id: 1 });
    mock.dispatchLifted({ type: "JUMP_TO_ACTION", actionId: 2 });
    expect(store.getState()).toBe(1);

    mock.dispatchLifted({ type: "SWEEP" });
    expect(store.getLiftedState().stagedActionIds).toEqual([0, 2]);

    mock.dispatchLifted({ type: "COMMIT", timestamp: 1 });
    expect(store.getLiftedState().stagedActionIds).toEqual([0]);
    expect(store.getLiftedState().committedState).toBe(1);

    mock.dispatchLifted({ type: "ROLLBACK", timestamp: 1 });
    mock.dispatchLifted({ type: "RESET", timestamp: 1 });
    expect(store.getState()).toBe(0);

    // INC, INC, jump(1), skip action 1 -> 0, jump to action 2 -> 1, reset -> 0
    expect(states).toEqual([0, 1, 2, 1, 0, 1, 0]);

    // Every history command results in a full state update.
    const fullUpdates = mock.extension.send.mock.calls.length;
    expect(fullUpdates).toBeGreaterThanOrEqual(8);
    store.destroy();
  });

  it("imports a lifted state sent by the extension", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });
    store.dispatch({ type: "INCREMENT" });
    store.dispatch({ type: "INCREMENT" });
    const exported = JSON.parse(
      JSON.stringify(store.getLiftedState()),
    ) as LiftedState<number, Action>;
    store.dispatch({ type: "DECREMENT" });
    expect(store.getState()).toBe(1);

    mock.start();
    mock.dispatchLifted({ type: "IMPORT_STATE", nextLiftedState: exported });
    expect(store.getState()).toBe(2);
    expect(store.getLiftedState().stagedActionIds).toEqual([0, 1, 2]);
    store.destroy();
  });

  it("records and reduces actions dispatched from the extension", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });
    const actions: Action[] = [];
    store.actions$.subscribe((action) => actions.push(action));

    mock.start();
    mock.dispatchAction("{ type: 'INCREMENT' }");
    mock.dispatchAction({ type: "INCREMENT" });

    expect(store.getState()).toBe(2);
    expect(actions).toEqual([{ type: "INCREMENT" }, { type: "INCREMENT" }]);
    expect(store.getLiftedState().stagedActionIds).toEqual([0, 1, 2]);
    store.destroy();
  });

  it("stops listening to the extension after STOP", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });
    store.dispatch({ type: "INCREMENT" });

    mock.start();
    mock.stop();
    mock.dispatchLifted({ type: "JUMP_TO_STATE", index: 0 });
    mock.dispatchAction({ type: "INCREMENT" });

    expect(store.getState()).toBe(1);
    store.dispatch({ type: "INCREMENT" });
    expect(store.getState()).toBe(2);
    store.destroy();
  });

  it("lets the extension lock and pause recording", () => {
    const mock = createMockDevtools();
    const store = instrument(counter, 0, { extension: mock.extension });
    mock.start();

    mock.dispatchLifted({ type: "LOCK_CHANGES", status: true });
    store.dispatch({ type: "INCREMENT" });
    expect(store.getState()).toBe(0);
    mock.dispatchLifted({ type: "LOCK_CHANGES", status: false });

    mock.dispatchLifted({ type: "PAUSE_RECORDING", status: true });
    mock.connection.send.mockClear();
    store.dispatch({ type: "INCREMENT" });
    expect(store.getState()).toBe(1);
    expect(mock.connection.send).not.toHaveBeenCalled();
    mock.dispatchLifted({ type: "PAUSE_RECORDING", status: false });
    expect(store.getLiftedState().committedState).toBe(1);
    store.destroy();
  });

  describe("filtered actions", () => {
    const cases: Array<[string, Partial<DevtoolsConfig<number, Action>>]> = [
      ["ignored", { predicate: (_, { type }) => type !== "FOO" }],
      ["blocked", { actionsBlocklist: ["FOO"] }],
      ["safe", { actionsSafelist: ["BAR"] }],
    ];
    for (const [name, options] of cases) {
      it(`should not throw if actions are ${name}`, () => {
        const mock = createMockDevtools();
        const store = instrument(counter, 0, {
          extension: mock.extension,
          ...options,
        });
        mock.start();
        expect(() => {
          store.dispatch({ type: "FOO" });
          store.devtools.refresh();
          store.dispatch({ type: "INCREMENT" });
        }).not.toThrow();
        expect(store.getState()).toBe(1);
        store.destroy();
      });
    }

    it("does not send filtered actions to the extension", () => {
      const mock = createMockDevtools();
      const store = instrument(counter, 0, {
        extension: mock.extension,
        actionsBlocklist: ["NOISE"],
      });
      store.dispatch({ type: "NOISE" });
      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "NOISE" });
      expect(mock.connection.send).toHaveBeenCalledTimes(1);
      expect(store.getLiftedState().stagedActionIds).toEqual([0, 1]);
      store.destroy();
    });
  });
});
