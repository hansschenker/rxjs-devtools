import { describe, expect, it } from "vitest";
import { Subject, of, throwError } from "rxjs";

import { LOG_ONLY_FEATURES } from "../src/config";
import {
  createInspector,
  DEFAULT_INSPECTOR_NAME,
  getDefaultInspector,
  inspect,
} from "../src/inspector";
import type { Action } from "../src/types";

describe("createInspector", () => {
  it("passes values through and records them", () => {
    const inspector = createInspector({ extension: null });
    const values: number[] = [];
    let completed = false;

    of(1, 2)
      .pipe(inspector.inspect("nums$"))
      .subscribe({
        next: (value) => values.push(value),
        complete: () => (completed = true),
      });

    expect(values).toEqual([1, 2]);
    expect(completed).toBe(true);
    expect(inspector.store.getState()).toEqual({
      nums$: { status: "completed", value: 2, emissions: 2, subscribers: 0 },
    });
    inspector.destroy();
  });

  it("records the notification kinds as action types", () => {
    const inspector = createInspector({ extension: null });
    of("a").pipe(inspector.inspect("letters$")).subscribe();

    const { actionsById, stagedActionIds } = inspector.store.getLiftedState();
    const types = stagedActionIds
      .slice(1)
      .map((id) => actionsById[id].action.type);
    expect(types).toEqual([
      "[letters$] subscribe",
      "[letters$] next",
      "[letters$] complete",
    ]);
    expect(actionsById[2].action).toEqual({
      type: "[letters$] next",
      stream: "letters$",
      kind: "next",
      value: "a",
    });
    inspector.destroy();
  });

  it("records errors", () => {
    const inspector = createInspector({ extension: null });
    let seen: unknown;
    throwError(() => new Error("boom"))
      .pipe(inspector.inspect("err$"))
      .subscribe({ error: (error) => (seen = error) });

    expect(seen).toBeInstanceOf(Error);
    expect(inspector.store.getState()["err$"]).toEqual({
      status: "errored",
      error: "Error: boom",
      emissions: 0,
      subscribers: 0,
    });
    inspector.destroy();
  });

  it("tracks subscriber counts and unsubscriptions", () => {
    const inspector = createInspector({ extension: null });
    const source = new Subject<number>();
    const inspected = source.pipe(inspector.inspect("shared$"));

    const first = inspected.subscribe();
    const second = inspected.subscribe();
    source.next(1);
    expect(inspector.store.getState()["shared$"]).toEqual({
      status: "active",
      value: 1,
      emissions: 2,
      subscribers: 2,
    });

    first.unsubscribe();
    expect(inspector.store.getState()["shared$"]).toMatchObject({
      status: "active",
      subscribers: 1,
    });

    second.unsubscribe();
    expect(inspector.store.getState()["shared$"]).toMatchObject({
      status: "unsubscribed",
      subscribers: 0,
    });

    const types = inspector.store
      .getLiftedState()
      .stagedActionIds.slice(1)
      .map(
        (id) => inspector.store.getLiftedState().actionsById[id].action.type,
      );
    expect(types).toEqual([
      "[shared$] subscribe",
      "[shared$] subscribe",
      "[shared$] next",
      "[shared$] next",
      "[shared$] unsubscribe",
      "[shared$] unsubscribe",
    ]);
    inspector.destroy();
  });

  it("keeps several streams side by side", () => {
    const inspector = createInspector({ extension: null });
    of(1).pipe(inspector.inspect("a$")).subscribe();
    of("x", "y").pipe(inspector.inspect("b$")).subscribe();
    expect(Object.keys(inspector.store.getState())).toEqual(["a$", "b$"]);
    expect(inspector.store.getState()["b$"].value).toBe("y");
    inspector.destroy();
  });

  it("is log-only by default and accepts overrides", () => {
    const inspector = createInspector({ extension: null });
    expect(inspector.store.config.name).toBe(DEFAULT_INSPECTOR_NAME);
    expect(inspector.store.config.logOnly).toBe(true);
    expect(inspector.store.config.features).toEqual(LOG_ONLY_FEATURES);
    inspector.destroy();

    const custom = createInspector(() => ({
      extension: null,
      name: "Custom",
      logOnly: false,
    }));
    expect(custom.store.config.name).toBe("Custom");
    expect(custom.store.config.features.jump).toBe(true);
    custom.destroy();
  });

  it("ignores foreign actions in its reducer", () => {
    const inspector = createInspector({ extension: null });
    const before = inspector.store.getState();
    inspector.store.dispatch({ type: "something else" } as Action as never);
    expect(inspector.store.getState()).toBe(before);
    inspector.destroy();
  });
});

describe("inspect", () => {
  it("records into the shared default inspector", () => {
    of(1, 2, 3).pipe(inspect("default$")).subscribe();
    expect(getDefaultInspector().store.getState()["default$"]).toEqual({
      status: "completed",
      value: 3,
      emissions: 3,
      subscribers: 0,
    });
    expect(getDefaultInspector()).toBe(getDefaultInspector());
  });
});
