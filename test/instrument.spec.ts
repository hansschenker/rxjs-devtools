import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { instrument, type InstrumentedStore } from "../src/devtools";
import type { DevtoolsOptions } from "../src/config";
import { PAUSE, RECOMPUTE, UPDATE, type LiftedState } from "../src/reducer";
import type { Action, ActionReducer } from "../src/types";
import {
  counter,
  counterWithAnotherBug,
  counterWithBug,
  doubleCounter,
} from "./helpers";

type Fixture = {
  store: InstrumentedStore<number, Action>;
  devtools: InstrumentedStore<number, Action>["devtools"];
  dispatch: (action: Action) => void;
  getState: () => number;
  getLiftedState: () => LiftedState<number, Action>;
  replaceReducer: (reducer: ActionReducer<number, Action>) => void;
  states: number[];
  cleanup: () => void;
};

function withoutExtension(
  options: DevtoolsOptions<number, Action>,
): DevtoolsOptions<number, Action> {
  return typeof options === "function"
    ? () => ({ extension: null, ...options() })
    : { extension: null, ...options };
}

function createFixture(
  reducer: ActionReducer<number, Action>,
  options: DevtoolsOptions<number, Action> = {},
): Fixture {
  const store = instrument<number, Action>(
    reducer,
    0,
    withoutExtension(options),
  );
  const states: number[] = [];
  const subscription = store.state$.subscribe((state) => states.push(state));
  return {
    store,
    devtools: store.devtools,
    dispatch: (action) => store.dispatch(action),
    getState: () => store.getState(),
    getLiftedState: () => store.getLiftedState(),
    replaceReducer: (next) => store.replaceReducer(next),
    states,
    cleanup: () => {
      subscription.unsubscribe();
      store.destroy();
    },
  };
}

describe("instrument", () => {
  describe("reducer", () => {
    it("should call the recompute action when the reducer is replaced", () => {
      const fixture = createFixture(doubleCounter);
      counter.mockClear();
      fixture.replaceReducer(counter);

      const allArgs = counter.mock.calls;
      expect(allArgs.length).toEqual(3);
      expect(allArgs[0][1].type).toEqual(UPDATE);
      expect(allArgs[1][1].type).toEqual(RECOMPUTE);
      expect(allArgs[2][1].type).toEqual(RECOMPUTE);
      fixture.cleanup();
    });
  });

  describe("Instrumentation", () => {
    let fixture: Fixture;
    let dispatch: Fixture["dispatch"];
    let devtools: Fixture["devtools"];
    let getState: Fixture["getState"];
    let getLiftedState: Fixture["getLiftedState"];

    beforeEach(() => {
      fixture = createFixture(counter);
      dispatch = fixture.dispatch;
      devtools = fixture.devtools;
      getState = fixture.getState;
      getLiftedState = fixture.getLiftedState;
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("should expose the initial state synchronously", () => {
      expect(getState()).toBe(0);
      expect(fixture.states).toEqual([0]);
      expect(getLiftedState().computedStates).toEqual([{ state: 0 }]);
    });

    it("should perform actions", () => {
      expect(getState()).toBe(0);
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(1);
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(2);
      expect(fixture.states).toEqual([0, 1, 2]);
    });

    it("should rollback state to the last committed state", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(2);

      devtools.commit();
      expect(getState()).toBe(2);

      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(4);

      devtools.rollback();
      expect(getState()).toBe(2);

      dispatch({ type: "DECREMENT" });
      expect(getState()).toBe(1);

      devtools.rollback();
      expect(getState()).toBe(2);
    });

    it("should refresh to show current state as is", () => {
      // actionId 0 = @@INIT
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(getState()).toBe(4);
      expect(getLiftedState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
      expect(getLiftedState().skippedActionIds).toEqual([]);

      devtools.refresh();

      expect(getState()).toBe(4);
      expect(getLiftedState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
      expect(getLiftedState().skippedActionIds).toEqual([]);
    });

    it("should reset to initial state", () => {
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(1);

      devtools.commit();
      expect(getState()).toBe(1);

      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(2);

      devtools.rollback();
      expect(getState()).toBe(1);

      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(2);

      devtools.reset();
      expect(getState()).toBe(0);
    });

    it("should toggle an action", () => {
      // actionId 0 = @@INIT
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(1);

      devtools.toggleAction(2);
      expect(getState()).toBe(2);

      devtools.toggleAction(2);
      expect(getState()).toBe(1);
    });

    it("should set a range of actions active or inactive", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(3);

      devtools.setActionsActive(1, 3, false);
      expect(getLiftedState().skippedActionIds).toEqual([1, 2]);
      expect(getState()).toBe(1);

      devtools.setActionsActive(1, 3, true);
      expect(getLiftedState().skippedActionIds).toEqual([]);
      expect(getState()).toBe(3);
    });

    it("should sweep disabled actions", () => {
      // actionId 0 = @@INIT
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(getState()).toBe(2);
      expect(getLiftedState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
      expect(getLiftedState().skippedActionIds).toEqual([]);

      devtools.toggleAction(2);

      expect(getState()).toBe(3);
      expect(getLiftedState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
      expect(getLiftedState().skippedActionIds).toEqual([2]);

      devtools.sweep();
      expect(getState()).toBe(3);
      expect(getLiftedState().stagedActionIds).toEqual([0, 1, 3, 4]);
      expect(getLiftedState().skippedActionIds).toEqual([]);
    });

    it("should jump to state", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(1);

      devtools.jumpToState(0);
      expect(getState()).toBe(0);

      devtools.jumpToState(1);
      expect(getState()).toBe(1);

      devtools.jumpToState(2);
      expect(getState()).toBe(0);

      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(0);

      devtools.jumpToState(4);
      expect(getState()).toBe(2);
    });

    it("should jump to action", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });
      expect(getState()).toBe(1);

      devtools.jumpToAction(2);
      expect(getState()).toBe(0);
    });

    it("should replace the reducer and preserve previous states", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(getState()).toBe(1);

      fixture.replaceReducer(doubleCounter);

      expect(getState()).toBe(1);
    });

    it("should replace the reducer and compute new state with latest reducer", () => {
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(getState()).toBe(1);

      fixture.replaceReducer(doubleCounter);

      dispatch({ type: "INCREMENT" });

      expect(getState()).toBe(3);
    });

    it("should catch and record errors", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fixture.replaceReducer(counterWithBug);

      dispatch({ type: "INCREMENT" });
      dispatch({ type: "DECREMENT" });
      dispatch({ type: "INCREMENT" });

      const { computedStates } = fixture.getLiftedState();
      expect(computedStates[3].error).toMatch(/ReferenceError/);
      expect(computedStates[4].error).toMatch(
        /Interrupted by an error up the chain/,
      );

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("should report reducer errors to the onError option", () => {
      const onError = vi.fn();
      const local = createFixture(counterWithBug, { onError });
      local.dispatch({ type: "DECREMENT" });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(ReferenceError);
      expect(local.getState()).toBe(0);
      local.cleanup();
    });

    it("should catch invalid action type", () => {
      expect(() => {
        dispatch({ type: undefined } as unknown as Action);
      }).toThrowError("Actions must have a type property");
      expect(() => {
        dispatch((() => ({ type: "x" })) as unknown as Action);
      }).toThrowError(/expected an object/);
      expect(() => {
        dispatch(undefined as unknown as Action);
      }).toThrowError("Actions must be objects");
    });

    it("should not recompute old states when toggling an action", () => {
      counter.mockClear();

      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(counter).toHaveBeenCalledTimes(3);

      devtools.toggleAction(3);
      expect(counter).toHaveBeenCalledTimes(3);

      devtools.toggleAction(3);
      expect(counter).toHaveBeenCalledTimes(4);

      devtools.toggleAction(2);
      expect(counter).toHaveBeenCalledTimes(5);

      devtools.toggleAction(2);
      expect(counter).toHaveBeenCalledTimes(7);

      devtools.toggleAction(1);
      expect(counter).toHaveBeenCalledTimes(9);

      devtools.toggleAction(2);
      expect(counter).toHaveBeenCalledTimes(10);

      devtools.toggleAction(3);
      expect(counter).toHaveBeenCalledTimes(10);

      devtools.toggleAction(1);
      expect(counter).toHaveBeenCalledTimes(11);

      devtools.toggleAction(3);
      expect(counter).toHaveBeenCalledTimes(12);

      devtools.toggleAction(2);
      expect(counter).toHaveBeenCalledTimes(14);
    });

    it("should not recompute states when jumping to state", () => {
      counter.mockClear();

      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(counter).toHaveBeenCalledTimes(3);

      const savedComputedStates = getLiftedState().computedStates;

      devtools.jumpToState(0);

      expect(counter).toHaveBeenCalledTimes(3);

      devtools.jumpToState(1);

      expect(counter).toHaveBeenCalledTimes(3);

      devtools.jumpToState(3);

      expect(counter).toHaveBeenCalledTimes(3);

      expect(getLiftedState().computedStates).toBe(savedComputedStates);
    });

    it("should not recompute states on monitor actions", () => {
      counter.mockClear();

      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });
      dispatch({ type: "INCREMENT" });

      expect(counter).toHaveBeenCalledTimes(3);

      const savedComputedStates = getLiftedState().computedStates;

      devtools.dispatch({ type: "lol" });

      expect(counter).toHaveBeenCalledTimes(3);

      devtools.dispatch({ type: "wat" });

      expect(counter).toHaveBeenCalledTimes(3);

      expect(getLiftedState().computedStates).toBe(savedComputedStates);
    });
  });

  describe("state$ and actions$", () => {
    it("should emit once per dispatched action, even when the state is unchanged", () => {
      const fixture = createFixture(counter);
      fixture.dispatch({ type: "NOOP" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "NOOP" });
      expect(fixture.states).toEqual([0, 0, 1, 1]);
      fixture.cleanup();
    });

    it("should not re-emit on devtools actions that leave the state alone", () => {
      const fixture = createFixture(counter);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.refresh();
      fixture.devtools.dispatch({ type: "monitor" });
      fixture.devtools.lockChanges(true);
      fixture.devtools.lockChanges(false);
      expect(fixture.states).toEqual([0, 1]);
      fixture.cleanup();
    });

    it("should emit when a devtools action changes the current state", () => {
      const fixture = createFixture(counter);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.jumpToState(1);
      fixture.devtools.toggleAction(1);
      // reset() yields 0 again, which equals the current state: no emission.
      fixture.devtools.reset();
      fixture.devtools.jumpToState(0);
      fixture.devtools.rollback();
      expect(fixture.states).toEqual([0, 1, 2, 1, 0]);
      fixture.cleanup();
    });

    it("should replay the current state to late subscribers", () => {
      const fixture = createFixture(counter);
      fixture.dispatch({ type: "INCREMENT" });
      const late: number[] = [];
      fixture.store.state$.subscribe((state) => late.push(state));
      expect(late).toEqual([1]);
      fixture.cleanup();
    });

    it("should emit reduced actions on actions$", () => {
      const fixture = createFixture(counter);
      const seen: Action[] = [];
      const statesWhenSeen: number[] = [];
      fixture.store.actions$.subscribe((action) => {
        seen.push(action);
        statesWhenSeen.push(fixture.getState());
      });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.jumpToState(0);
      fixture.dispatch({ type: "DECREMENT" });
      expect(seen).toEqual([{ type: "INCREMENT" }, { type: "DECREMENT" }]);
      expect(statesWhenSeen).toEqual([1, 0]);
      fixture.cleanup();
    });

    it("should queue actions dispatched from within a subscriber", () => {
      const fixture = createFixture(counter);
      const seen: number[] = [];
      fixture.store.state$.subscribe((state) => {
        seen.push(state);
        if (state === 1) {
          fixture.dispatch({ type: "INCREMENT" });
        }
      });
      fixture.dispatch({ type: "INCREMENT" });
      expect(seen).toEqual([0, 1, 2]);
      expect(fixture.getState()).toBe(2);
      fixture.cleanup();
    });

    it("should complete every stream on destroy", () => {
      const fixture = createFixture(counter);
      const completed: string[] = [];
      fixture.store.state$.subscribe({
        complete: () => completed.push("state$"),
      });
      fixture.store.actions$.subscribe({
        complete: () => completed.push("actions$"),
      });
      fixture.store.liftedState$.subscribe({
        complete: () => completed.push("liftedState$"),
      });
      fixture.store.destroy();
      expect(completed.sort()).toEqual(["actions$", "liftedState$", "state$"]);
      fixture.cleanup();
    });
  });

  describe("Filtered actions", () => {
    it("should respect the predicate option", () => {
      const fixture = createFixture(counter, {
        predicate: (_state, action) => action.type !== "INCREMENT",
      });

      expect(fixture.getState()).toBe(0);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      expect(fixture.getState()).toBe(5);

      // init, decrement, decrement
      const {
        stagedActionIds,
        actionsById,
        computedStates,
        currentStateIndex,
      } = fixture.getLiftedState();
      expect(stagedActionIds.length).toBe(3);
      expect(Object.keys(actionsById).length).toBe(3);
      expect(computedStates.length).toBe(3);
      expect(currentStateIndex).toBe(2);

      fixture.devtools.jumpToAction(0);
      expect(fixture.getState()).toBe(1);

      fixture.devtools.jumpToAction(1);
      expect(fixture.getState()).toBe(6);

      fixture.devtools.jumpToAction(2);
      expect(fixture.getState()).toBe(5);
      fixture.cleanup();
    });

    it("should hand the predicate the unlifted state", () => {
      const predicate = vi.fn(() => true);
      const fixture = createFixture(counter, { predicate });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      expect(predicate).toHaveBeenLastCalledWith(1, { type: "INCREMENT" });
      fixture.cleanup();
    });

    it("should respect the blocked option", () => {
      const fixture = createFixture(counter, {
        actionsBlocklist: ["INCREMENT"],
      });

      expect(fixture.getState()).toBe(0);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      expect(fixture.getState()).toBe(5);

      // init, decrement, decrement
      const {
        stagedActionIds,
        actionsById,
        computedStates,
        currentStateIndex,
      } = fixture.getLiftedState();
      expect(stagedActionIds.length).toBe(3);
      expect(Object.keys(actionsById).length).toBe(3);
      expect(computedStates.length).toBe(3);
      expect(currentStateIndex).toBe(2);

      fixture.devtools.jumpToAction(0);
      expect(fixture.getState()).toBe(1);

      fixture.devtools.jumpToAction(1);
      expect(fixture.getState()).toBe(6);

      fixture.devtools.jumpToAction(2);
      expect(fixture.getState()).toBe(5);
      fixture.cleanup();
    });

    it("should respect the safe option", () => {
      const fixture = createFixture(counter, {
        actionsSafelist: ["DECREMENT"],
      });

      expect(fixture.getState()).toBe(0);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      expect(fixture.getState()).toBe(5);

      // init, decrement, decrement
      const {
        stagedActionIds,
        actionsById,
        computedStates,
        currentStateIndex,
      } = fixture.getLiftedState();
      expect(stagedActionIds.length).toBe(3);
      expect(Object.keys(actionsById).length).toBe(3);
      expect(computedStates.length).toBe(3);
      expect(currentStateIndex).toBe(2);

      fixture.devtools.jumpToAction(0);
      expect(fixture.getState()).toBe(1);

      fixture.devtools.jumpToAction(1);
      expect(fixture.getState()).toBe(6);

      fixture.devtools.jumpToAction(2);
      expect(fixture.getState()).toBe(5);
      fixture.cleanup();
    });
  });

  describe("maxAge option", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should auto-commit earliest non-@@INIT action when maxAge is reached", () => {
      const fixture = createFixture(counter, { maxAge: 3 });

      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      let liftedStoreState = fixture.getLiftedState();

      expect(fixture.getState()).toBe(2);
      expect(Object.keys(liftedStoreState.actionsById).length).toBe(3);
      expect(liftedStoreState.committedState).toBe(0);
      expect(liftedStoreState.stagedActionIds).toContain(1);

      // Trigger auto-commit.
      fixture.dispatch({ type: "INCREMENT" });
      liftedStoreState = fixture.getLiftedState();

      expect(fixture.getState()).toBe(3);
      expect(Object.keys(liftedStoreState.actionsById).length).toBe(3);
      expect(liftedStoreState.stagedActionIds).not.toContain(1);
      expect(liftedStoreState.computedStates[0].state).toEqual(1);
      expect(liftedStoreState.committedState).toEqual(1);
      expect(liftedStoreState.currentStateIndex).toBe(2);

      fixture.cleanup();
    });

    it("should remove skipped actions once committed", () => {
      const fixture = createFixture(counter, { maxAge: 3 });

      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.toggleAction(1);
      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().skippedActionIds.indexOf(1)).not.toBe(-1);
      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().skippedActionIds.indexOf(1)).toBe(-1);

      fixture.cleanup();
    });

    it("should not auto-commit errors", () => {
      const fixture = createFixture(counterWithBug, { maxAge: 3 });

      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().stagedActionIds.length).toBe(3);

      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().stagedActionIds.length).toBe(4);

      fixture.cleanup();
    });

    it("should auto-commit actions after hot reload fixes error", () => {
      const fixture = createFixture(counterWithBug, { maxAge: 3 });

      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      expect(fixture.getLiftedState().stagedActionIds.length).toBe(7);

      // Auto-commit 2 actions by "fixing" reducer bug, but introducing another.
      fixture.replaceReducer(counterWithAnotherBug);
      expect(fixture.getLiftedState().stagedActionIds.length).toBe(5);

      // Auto-commit 2 more actions by "fixing" other reducer bug.
      fixture.replaceReducer(counter);
      expect(fixture.getLiftedState().stagedActionIds.length).toBe(3);

      fixture.cleanup();
    });

    it("should update currentStateIndex when auto-committing", () => {
      const fixture = createFixture(counter, { maxAge: 3 });

      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });

      expect(fixture.getLiftedState().currentStateIndex).toBe(2);

      // currentStateIndex should stay at 2 as actions are committed.
      fixture.dispatch({ type: "INCREMENT" });
      const liftedStoreState = fixture.getLiftedState();
      const currentComputedState =
        liftedStoreState.computedStates[liftedStoreState.currentStateIndex];

      expect(liftedStoreState.currentStateIndex).toBe(2);
      expect(currentComputedState.state).toEqual(3);

      fixture.cleanup();
    });

    it("should continue to increment currentStateIndex while error blocks commit", () => {
      const fixture = createFixture(counterWithBug, { maxAge: 3 });

      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });

      const liftedStoreState = fixture.getLiftedState();
      const currentComputedState =
        liftedStoreState.computedStates[liftedStoreState.currentStateIndex];
      expect(liftedStoreState.currentStateIndex).toBe(4);
      expect(currentComputedState.state).toEqual(0);
      expect(currentComputedState.error).toBeDefined();

      fixture.cleanup();
    });

    it("should adjust currentStateIndex correctly when multiple actions are committed", () => {
      const fixture = createFixture(counterWithBug, { maxAge: 3 });

      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });

      // Auto-commit 2 actions by "fixing" reducer bug.
      fixture.replaceReducer(counter);
      const liftedStoreState = fixture.getLiftedState();
      const currentComputedState =
        liftedStoreState.computedStates[liftedStoreState.currentStateIndex];
      expect(liftedStoreState.currentStateIndex).toBe(2);
      expect(currentComputedState.state).toEqual(-4);

      fixture.cleanup();
    });

    it("should not allow currentStateIndex to drop below 0", () => {
      const fixture = createFixture(counterWithBug, { maxAge: 3 });

      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });
      fixture.devtools.jumpToState(1);

      // Auto-commit 2 actions by "fixing" reducer bug.
      fixture.replaceReducer(counter);
      const liftedStoreState = fixture.getLiftedState();
      const currentComputedState =
        liftedStoreState.computedStates[liftedStoreState.currentStateIndex];
      expect(liftedStoreState.currentStateIndex).toBe(0);
      expect(currentComputedState.state).toEqual(-2);

      fixture.cleanup();
    });

    it("should throw error when maxAge < 2", () => {
      expect(() => {
        createFixture(counter, { maxAge: 1 });
      }).toThrowError(/cannot be less than/);
    });

    it("should support a function to return devtools options", () => {
      expect(() => {
        createFixture(counter, () => ({ maxAge: 1 }));
      }).toThrowError(/cannot be less than/);
    });
  });

  describe("Import State", () => {
    let fixture: Fixture;
    let exportedState: LiftedState<number, Action>;

    beforeEach(() => {
      fixture = createFixture(counter);

      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });

      exportedState = fixture.getLiftedState();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("should replay all the steps when a state is imported", () => {
      fixture.devtools.importState(exportedState);
      expect(fixture.getLiftedState()).toEqual(exportedState);
    });

    it("should replace the existing action log with the one imported", () => {
      fixture.dispatch({ type: "DECREMENT" });
      fixture.dispatch({ type: "DECREMENT" });

      fixture.devtools.importState(exportedState);
      expect(fixture.getLiftedState()).toEqual(exportedState);
      expect(fixture.getState()).toBe(3);
    });

    it("should survive a JSON round trip", () => {
      fixture.dispatch({ type: "DECREMENT" });
      const roundTripped = JSON.parse(
        JSON.stringify(exportedState),
      ) as LiftedState<number, Action>;
      fixture.devtools.importState(roundTripped);
      expect(fixture.getState()).toBe(3);
      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getState()).toBe(4);
    });
  });

  describe("Lock Changes", () => {
    let fixture: Fixture;
    beforeEach(() => {
      fixture = createFixture(counter);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.lockChanges(true);
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("should update state correctly", () => {
      expect(fixture.getLiftedState().isLocked).toBe(true);
      expect(fixture.getLiftedState().nextActionId).toBe(3);
      expect(fixture.getState()).toBe(2);
    });

    it("should not accept changes during lock", () => {
      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().nextActionId).toBe(3);
      expect(fixture.getState()).toBe(2);
    });

    it("should be able to skip / time travel during lock", () => {
      fixture.devtools.toggleAction(1);
      expect(fixture.getState()).toBe(1);
      fixture.devtools.toggleAction(1);
      expect(fixture.getState()).toBe(2);
      fixture.devtools.jumpToAction(1);
      expect(fixture.getState()).toBe(1);
      fixture.devtools.jumpToAction(2);
      expect(fixture.getState()).toBe(2);
    });

    it("should work correctly after unlock", () => {
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.jumpToAction(1);
      fixture.devtools.jumpToAction(2);
      fixture.devtools.lockChanges(false);
      expect(fixture.getLiftedState().isLocked).toBe(false);
      expect(fixture.getLiftedState().nextActionId).toBe(3);
      expect(fixture.getState()).toBe(2);

      fixture.dispatch({ type: "INCREMENT" });
      expect(fixture.getLiftedState().nextActionId).toBe(4);
      expect(fixture.getState()).toBe(3);
    });
  });

  describe("pause recording", () => {
    let fixture: Fixture;
    beforeEach(() => {
      fixture = createFixture(counter);
      fixture.dispatch({ type: "INCREMENT" });
      fixture.dispatch({ type: "INCREMENT" });
      fixture.devtools.pauseRecording(true);
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("should update pause correctly", () => {
      expect(fixture.getLiftedState().isPaused).toBe(true);
      fixture.devtools.pauseRecording(false);
      expect(fixture.getLiftedState().isPaused).toBe(false);
    });

    it("should create a copy of the last state before pausing", () => {
      const computedStates = fixture.getLiftedState().computedStates;
      expect(computedStates.length).toBe(4);
      expect(computedStates[3]).toEqual(computedStates[2]);
      expect(fixture.getLiftedState().currentStateIndex).toBe(3);
      expect(fixture.getState()).toBe(2);
    });

    it("should add pause action", () => {
      const liftedState = fixture.getLiftedState();
      expect(liftedState.nextActionId).toBe(4);
      expect(liftedState.actionsById[3].action.type).toEqual(PAUSE);
    });

    it("should overwrite last state during pause but keep action", () => {
      fixture.dispatch({ type: "DECREMENT" });
      const liftedState = fixture.getLiftedState();
      expect(liftedState.currentStateIndex).toBe(3);
      expect(liftedState.computedStates.length).toBe(4);
      expect(fixture.getState()).toEqual(1);
      expect(liftedState.nextActionId).toBe(4);
      expect(liftedState.actionsById[3].action.type).toEqual(PAUSE);
    });

    it("recomputation of states should preserve last state", () => {
      fixture.devtools.jumpToState(1);
      expect(fixture.getState()).toBe(1);
      fixture.devtools.jumpToState(3);
      expect(fixture.getState()).toBe(2);
      fixture.devtools.toggleAction(1);
      expect(fixture.getState()).toBe(2);
      fixture.devtools.jumpToState(2);
      expect(fixture.getState()).toBe(1);
    });

    it("reducer update should not be recorded but should still be applied", () => {
      const oldComputedStates = fixture.getLiftedState().computedStates;
      fixture.dispatch({ type: UPDATE });
      expect(fixture.getState()).toBe(2);
      const liftedState = fixture.getLiftedState();
      expect(liftedState.nextActionId).toBe(4);
      expect(liftedState.actionsById[3].action.type).toEqual(PAUSE);
      expect(oldComputedStates).not.toBe(liftedState.computedStates);
    });

    it("should squash the history when recording resumes", () => {
      fixture.dispatch({ type: "DECREMENT" });
      fixture.devtools.pauseRecording(false);
      const liftedState = fixture.getLiftedState();
      expect(liftedState.stagedActionIds).toEqual([0]);
      expect(liftedState.committedState).toBe(1);
      expect(fixture.getState()).toBe(1);
    });
  });
});
