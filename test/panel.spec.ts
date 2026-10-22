// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instrument, type InstrumentedStore } from "../src/devtools";
import { diffStates } from "../src/panel/diff";
import { RXJS_DEVTOOLS_ICON_DATA_URI } from "../src/panel/icon";
import {
  createDevtoolsPanel,
  DEFAULT_PANEL_TITLE,
  openDevtoolsWindow,
  type DevtoolsPanel,
} from "../src/panel/panel";
import { safeStringify } from "../src/panel/stringify";
import type { Action } from "../src/types";
import { counter } from "./helpers";

interface Fixture {
  container: HTMLElement;
  store: InstrumentedStore<number, Action>;
  panel: DevtoolsPanel;
  rows(): HTMLElement[];
  types(): string[];
  row(id: number): HTMLElement;
  text(selector: string): string;
  slider(): HTMLInputElement;
}

const fixtures: Fixture[] = [];

function click(element: Element | null | undefined): void {
  if (!element) {
    throw new Error("missing element");
  }
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) {
    throw new Error(`no button labelled ${label}`);
  }
  return found;
}

function setup(): Fixture {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const store = instrument<number, Action>(counter, 0, { extension: null });
  const panel = createDevtoolsPanel({ container });
  panel.attach("Counter", store);
  const fixture: Fixture = {
    container,
    store,
    panel,
    rows: () => [...container.querySelectorAll<HTMLElement>(".rxdt-row")],
    types: () =>
      fixture
        .rows()
        .map((row) => row.querySelector(".rxdt-row-type")?.textContent ?? ""),
    row: (id) => {
      const row = container.querySelector<HTMLElement>(
        `.rxdt-row[data-action-id="${id}"]`,
      );
      if (!row) {
        throw new Error(`no row for action ${id}`);
      }
      return row;
    },
    text: (selector) => container.querySelector(selector)?.textContent ?? "",
    slider: () => {
      const slider = container.querySelector<HTMLInputElement>(".rxdt-slider");
      if (!slider) {
        throw new Error("no slider");
      }
      return slider;
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.panel.destroy();
    fixture.store.destroy();
    fixture.container.remove();
  }
  vi.restoreAllMocks();
});

describe("createDevtoolsPanel", () => {
  it("renders the title, its own icon and one row per staged action", () => {
    const f = setup();
    expect(f.text(".rxdt-title")).toBe(DEFAULT_PANEL_TITLE);
    expect(f.container.querySelector(".rxdt-icon svg")).not.toBeNull();
    expect(f.container.querySelector(".rxdt-icon svg")?.outerHTML).not.toMatch(
      /redux/i,
    );
    expect(f.types()).toEqual(["@rxjs-devtools/init"]);

    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "DECREMENT" });
    expect(f.types()).toEqual([
      "@rxjs-devtools/init",
      "INCREMENT",
      "DECREMENT",
    ]);
    expect(f.row(2).classList.contains("is-current")).toBe(true);
    expect(f.text(".rxdt-status")).toBe("2 / 2");
    expect(f.slider().max).toBe("2");
    expect(f.slider().value).toBe("2");
  });

  it("jumps and skips from the row buttons", () => {
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "INCREMENT" });
    expect(f.store.getState()).toBe(2);

    click(buttonIn(f.row(1), "Jump"));
    expect(f.store.getState()).toBe(1);
    expect(f.row(1).classList.contains("is-current")).toBe(true);
    expect(f.slider().value).toBe("1");

    click(buttonIn(f.row(1), "Skip"));
    expect(f.store.getLiftedState().skippedActionIds).toEqual([1]);
    expect(f.row(1).classList.contains("is-skipped")).toBe(true);
    expect(f.text(".rxdt-status")).toContain("1 skipped");
    expect(f.store.getState()).toBe(0);

    click(buttonIn(f.row(1), "Unskip"));
    expect(f.store.getLiftedState().skippedActionIds).toEqual([]);
    expect(f.store.getState()).toBe(1);
    expect(
      f.row(0).querySelector("button[title='Toggle this action']"),
    ).toBeNull();
  });

  it("drives time travel from the slider and the step buttons", () => {
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "INCREMENT" });

    f.slider().value = "0";
    f.slider().dispatchEvent(new Event("input", { bubbles: true }));
    expect(f.store.getState()).toBe(0);

    click(buttonIn(f.container, "Next"));
    expect(f.store.getState()).toBe(1);
    click(buttonIn(f.container, "Prev"));
    click(buttonIn(f.container, "Prev"));
    expect(f.store.getState()).toBe(0);
  });

  it("replays the history with the play button", () => {
    vi.useFakeTimers();
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "INCREMENT" });

    click(buttonIn(f.container, "Play"));
    expect(f.store.getState()).toBe(0);
    expect(buttonIn(f.container, "Stop")).toBeDefined();
    vi.advanceTimersByTime(500);
    expect(f.store.getState()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(f.store.getState()).toBe(2);
    vi.advanceTimersByTime(500);
    expect(buttonIn(f.container, "Play")).toBeDefined();
    vi.useRealTimers();
  });

  it("mirrors pause, lock, commit and reset in the toolbar", () => {
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });

    click(buttonIn(f.container, "Pause"));
    expect(f.store.getLiftedState().isPaused).toBe(true);
    expect(f.text(".rxdt-status")).toContain("paused");
    click(buttonIn(f.container, "Resume"));
    expect(f.store.getLiftedState().isPaused).toBe(false);

    click(buttonIn(f.container, "Lock"));
    f.store.dispatch({ type: "INCREMENT" });
    expect(f.store.getState()).toBe(1);
    expect(f.text(".rxdt-status")).toContain("locked");
    click(buttonIn(f.container, "Unlock"));

    f.store.dispatch({ type: "INCREMENT" });
    click(buttonIn(f.container, "Commit"));
    expect(f.store.getLiftedState().stagedActionIds).toEqual([0]);
    expect(f.store.getState()).toBe(2);

    click(buttonIn(f.container, "Reset"));
    expect(f.store.getState()).toBe(0);
    expect(buttonIn(f.container, "Sweep").disabled).toBe(true);
  });

  it("shows action, state and diff for the selected row", () => {
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "DECREMENT" });

    click(f.row(1));
    expect(f.row(1).classList.contains("is-selected")).toBe(true);

    click(buttonIn(f.container, "Action"));
    expect(f.text(".rxdt-detail")).toContain('"type": "INCREMENT"');

    click(buttonIn(f.container, "State"));
    expect(f.text(".rxdt-detail").trim()).toBe("1");

    click(buttonIn(f.container, "Diff"));
    const cells = [...f.container.querySelectorAll(".rxdt-diff td")].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual(["(root)", "changed", "0 → 1"]);
  });

  it("filters the action list by type", () => {
    const f = setup();
    f.store.dispatch({ type: "INCREMENT" });
    f.store.dispatch({ type: "DECREMENT" });
    const input = f.container.querySelector<HTMLInputElement>(".rxdt-filter");
    if (!input) throw new Error("no filter input");
    input.value = "decre";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(f.types()).toEqual(["DECREMENT"]);
  });

  it("switches between attached stores", () => {
    const f = setup();
    const other = instrument<number, Action>(counter, 10, { extension: null });
    other.dispatch({ type: "INCREMENT" });
    const select = f.container.querySelector<HTMLSelectElement>(".rxdt-select");
    if (!select) throw new Error("no select");
    expect(select.hidden).toBe(true);

    const detach = f.panel.attach("Other", other);
    expect(f.panel.instances).toEqual(["Counter", "Other"]);
    expect(select.hidden).toBe(false);
    expect(f.types()).toEqual(["@rxjs-devtools/init"]);

    select.value = "Other";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(f.types()).toEqual(["@rxjs-devtools/init", "INCREMENT"]);
    click(buttonIn(f.container, "State"));
    expect(f.text(".rxdt-detail").trim()).toBe("11");

    detach();
    expect(f.panel.instances).toEqual(["Counter"]);
    expect(f.types()).toEqual(["@rxjs-devtools/init"]);
    other.destroy();
  });

  it("detaches a store when it is destroyed", () => {
    const f = setup();
    f.store.destroy();
    expect(f.panel.instances).toEqual([]);
    expect(f.text(".rxdt-empty")).toContain("No store attached");
  });

  it("stops rendering and ignores attach after destroy", () => {
    const f = setup();
    f.panel.destroy();
    expect(f.container.querySelector(".rxdt")).toBeNull();
    expect(() => f.store.dispatch({ type: "INCREMENT" })).not.toThrow();
    f.panel.attach("Again", f.store);
    expect(f.panel.instances).toEqual([]);
  });
});

describe("openDevtoolsWindow", () => {
  it("returns null when the popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openDevtoolsWindow()).toBeNull();
  });

  it("opens a window titled RxJS DevTools with its own icon", () => {
    const popup = new JSDOM(
      "<!doctype html><html><head></head><body></body></html>",
    ).window;
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    const panel = openDevtoolsWindow();
    expect(panel).not.toBeNull();
    expect(popup.document.title).toBe(DEFAULT_PANEL_TITLE);
    const icon = popup.document.querySelector('link[rel="icon"]');
    expect(icon?.getAttribute("href")).toBe(RXJS_DEVTOOLS_ICON_DATA_URI);
    expect(icon?.getAttribute("href")).not.toMatch(/redux/i);
    expect(popup.document.querySelector(".rxdt-title")?.textContent).toBe(
      DEFAULT_PANEL_TITLE,
    );

    // The same window yields the same panel.
    expect(openDevtoolsWindow()).toBe(panel);

    const store = instrument<number, Action>(counter, 0, { extension: null });
    panel?.attach("Counter", store);
    store.dispatch({ type: "INCREMENT" });
    expect(popup.document.querySelectorAll(".rxdt-row")).toHaveLength(2);

    panel?.destroy();
    expect(popup.document.querySelector(".rxdt")).toBeNull();
    store.destroy();
  });

  it("pops an inline panel out with its instances", () => {
    const popup = new JSDOM(
      "<!doctype html><html><head></head><body></body></html>",
    ).window;
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const f = setup();
    const popped = f.panel.popOut({ title: "Custom title" });
    expect(popped?.instances).toEqual(["Counter"]);
    expect(popup.document.title).toBe("Custom title");
    popped?.destroy();
  });
});

describe("diffStates", () => {
  it("reports nothing for identical values", () => {
    expect(diffStates(1, 1)).toEqual([]);
    const same = { a: [1] };
    expect(diffStates(same, same)).toEqual([]);
  });

  it("describes primitive, nested, added and removed changes", () => {
    expect(diffStates(0, 1)).toEqual([
      { path: "(root)", kind: "changed", before: 0, after: 1 },
    ]);
    expect(
      diffStates(
        { a: 1, b: { c: [1, 2] } },
        { a: 1, b: { c: [1, 3] }, d: true },
      ),
    ).toEqual([
      { path: "b.c[1]", kind: "changed", before: 2, after: 3 },
      { path: "d", kind: "added", after: true },
    ]);
    expect(diffStates({ a: 1 }, {})).toEqual([
      { path: "a", kind: "removed", before: 1 },
    ]);
  });

  it("treats arrays and objects as different containers and honours the limit", () => {
    expect(diffStates([1], { 0: 1 })).toEqual([
      { path: "(root)", kind: "changed", before: [1], after: { 0: 1 } },
    ]);
    expect(
      diffStates({ a: 1, b: 1, c: 1 }, { a: 2, b: 2, c: 2 }, 2),
    ).toHaveLength(2);
  });
});

describe("safeStringify", () => {
  it("never throws on awkward values", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const shared = { x: 1 };
    const value = {
      cyclic,
      twice: [shared, shared],
      fn: () => 1,
      big: 10n,
      map: new Map([["k", 1]]),
      set: new Set([1, 2]),
      error: new Error("boom"),
    };
    const text = safeStringify(value, 0);
    expect(text).toContain('"self":"[Circular]"');
    expect(text).toContain('"twice":[{"x":1},{"x":1}]');
    expect(text).toContain('"fn":"[Function fn]"');
    expect(text).toContain('"big":"10n"');
    expect(text).toContain('"map":{"k":1}');
    expect(text).toContain('"set":[1,2]');
    expect(text).toContain('"error":{"name":"Error","message":"boom"}');
    expect(safeStringify(undefined)).toBe("undefined");
  });
});
