import type { PerformAction } from "../actions";
import type { InstrumentedStore } from "../devtools";
import type { LiftedState } from "../reducer";
import type { Action } from "../types";
import { diffStates } from "./diff";
import { RXJS_DEVTOOLS_ICON_DATA_URI, RXJS_DEVTOOLS_ICON_SVG } from "./icon";
import { safeStringify } from "./stringify";
import { PANEL_STYLES } from "./styles";

export const DEFAULT_PANEL_TITLE = "RxJS DevTools";

type AnyStore = InstrumentedStore<unknown, Action>;
type AnyLiftedState = LiftedState<unknown, Action>;
type DetailTab = "action" | "state" | "diff";

export interface DevtoolsPanelOptions {
  /** Element the panel renders into. The panel fills the element's height. */
  container: HTMLElement;
  /** Heading shown in the panel (default `"RxJS DevTools"`). */
  title?: string;
}

export interface DevtoolsWindowOptions {
  /** Window title and panel heading (default `"RxJS DevTools"`). */
  title?: string;
  /** `window.open` target name; reusing it focuses the existing window. */
  name?: string;
  /** `window.open` feature string. */
  features?: string;
}

/**
 * A monitor for instrumented stores: action list with jump and skip, state,
 * action and diff views, history commands and a time-travel slider. It works
 * with or without the browser extension because it reads `liftedState$` and
 * issues commands through `store.devtools`.
 */
export interface DevtoolsPanel {
  readonly element: HTMLElement;
  /** Names of the attached stores, in attach order. */
  readonly instances: readonly string[];
  /**
   * Shows a store under `name`. Attaching the same name again replaces the
   * previous store. The store is detached automatically when it is destroyed.
   * Returns a function that detaches it.
   */
  attach<S, A extends Action>(
    name: string,
    store: InstrumentedStore<S, A>,
  ): () => void;
  detach(name: string): void;
  /** Switches the view to the named store. */
  select(name: string): void;
  /**
   * Opens the attached stores in a separate window; `null` if popups are
   * blocked. While that window is open it mirrors every later `attach` and
   * `detach` on this panel.
   */
  popOut(options?: DevtoolsWindowOptions): DevtoolsPanel | null;
  /** Unsubscribes from every store and removes the panel from the document. */
  destroy(): void;
  /** `true` once `destroy` ran or, for a window, once it was closed. */
  readonly destroyed: boolean;
}

interface Instance {
  store: AnyStore;
  liftedState?: AnyLiftedState;
  unsubscribe(): void;
}

const STYLE_ATTRIBUTE = "data-rxjs-devtools";
const PLAY_INTERVAL = 500;
const MAX_ROWS = 1000;

function ensureStyles(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)) {
    return;
  }
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = PANEL_STYLES;
  doc.head.appendChild(style);
}

interface ElementProps {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: ElementProps = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (props.className) {
    node.className = props.className;
  }
  if (props.text !== undefined) {
    node.textContent = props.text;
  }
  if (props.title) {
    node.title = props.title;
  }
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      node.setAttribute(name, value);
    }
  }
  if (props.onClick) {
    node.addEventListener("click", props.onClick as EventListener);
  }
  node.append(...children);
  return node;
}

function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function formatTime(
  entry: PerformAction<Action> | undefined,
  previous: PerformAction<Action> | undefined,
): string {
  if (!entry || typeof entry.timestamp !== "number") {
    return "";
  }
  if (!previous || typeof previous.timestamp !== "number") {
    return new Date(entry.timestamp).toLocaleTimeString();
  }
  const delta = entry.timestamp - previous.timestamp;
  if (delta < 1000) {
    return `+${delta} ms`;
  }
  if (delta < 60_000) {
    return `+${(delta / 1000).toFixed(1)} s`;
  }
  return `+${Math.round(delta / 60_000)} min`;
}

function previewValue(value: unknown): string {
  const text = safeStringify(value, 0);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Renders an RxJS DevTools panel into `container`.
 *
 * ```ts
 * const panel = createDevtoolsPanel({ container: document.getElementById("devtools")! });
 * panel.attach("Counter", store);
 * source$.pipe(instrumentScan(reducer, seed, { onStore: (s) => panel.attach("Ticker", s) }));
 * ```
 */
export function createDevtoolsPanel(
  options: DevtoolsPanelOptions,
): DevtoolsPanel {
  const { container } = options;
  const doc = container.ownerDocument;
  const title = options.title ?? DEFAULT_PANEL_TITLE;
  ensureStyles(doc);

  const instances = new Map<string, Instance>();
  let active: string | undefined;
  let selectedId: number | undefined;
  let tab: DetailTab = "state";
  let filter = "";
  let playTimer: ReturnType<typeof setInterval> | undefined;
  let destroyed = false;
  // Popped-out windows that mirror this panel's attach/detach calls.
  const linked = new Set<DevtoolsPanel>();

  const forEachLinked = (run: (panel: DevtoolsPanel) => void): void => {
    for (const panel of linked) {
      if (panel.destroyed) {
        linked.delete(panel);
      } else {
        run(panel);
      }
    }
  };

  const current = (): Instance | undefined =>
    active === undefined ? undefined : instances.get(active);

  const command = (run: (store: AnyStore) => void): void => {
    const instance = current();
    if (instance) {
      run(instance.store);
    }
  };

  const button = (
    text: string,
    onClick: (event: MouseEvent) => void,
    hint?: string,
  ): HTMLButtonElement =>
    el(doc, "button", {
      text,
      title: hint,
      attrs: { type: "button" },
      onClick,
    });

  // ----- header -----------------------------------------------------------

  const icon = el(doc, "span", { className: "rxdt-icon" });
  icon.innerHTML = RXJS_DEVTOOLS_ICON_SVG;
  const heading = el(doc, "span", { className: "rxdt-title", text: title });
  const instanceSelect = el(doc, "select", {
    className: "rxdt-select",
    attrs: { "aria-label": "Instance" },
  });
  instanceSelect.addEventListener("change", () => select(instanceSelect.value));

  const pauseButton = button(
    "Pause",
    () =>
      command((store) =>
        store.devtools.pauseRecording(!current()?.liftedState?.isPaused),
      ),
    "Pause or resume recording",
  );
  const lockButton = button(
    "Lock",
    () =>
      command((store) =>
        store.devtools.lockChanges(!current()?.liftedState?.isLocked),
      ),
    "Lock or unlock dispatching",
  );
  const commitButton = button(
    "Commit",
    () => command((store) => store.devtools.commit()),
    "Squash the history into a new starting state",
  );
  const revertButton = button(
    "Revert",
    () => command((store) => store.devtools.rollback()),
    "Return to the last committed state",
  );
  const sweepButton = button(
    "Sweep",
    () => command((store) => store.devtools.sweep()),
    "Drop skipped actions",
  );
  const resetButton = button(
    "Reset",
    () => command((store) => store.devtools.reset()),
    "Return to the initial state",
  );
  const exportButton = button(
    "Export",
    () => exportState(),
    "Download the history as JSON",
  );
  const fileInput = el(doc, "input", {
    attrs: { type: "file", accept: ".json,application/json", hidden: "" },
  });
  fileInput.addEventListener("change", () => importFile());
  const importButton = button(
    "Import",
    () => fileInput.click(),
    "Load a history JSON file",
  );
  const popOutButton = button(
    "Pop out",
    () => popOut(),
    "Open in a separate window",
  );

  const toolbar = el(doc, "div", { className: "rxdt-toolbar" }, [
    pauseButton,
    lockButton,
    commitButton,
    revertButton,
    sweepButton,
    resetButton,
    exportButton,
    importButton,
    fileInput,
    popOutButton,
  ]);
  const header = el(doc, "header", { className: "rxdt-header" }, [
    icon,
    heading,
    instanceSelect,
    toolbar,
  ]);

  // ----- main ---------------------------------------------------------------

  const filterInput = el(doc, "input", {
    className: "rxdt-filter",
    attrs: {
      type: "search",
      placeholder: "Filter actions",
      "aria-label": "Filter actions",
    },
  });
  filterInput.addEventListener("input", () => {
    filter = filterInput.value;
    render();
  });
  const list = el(doc, "ol", { className: "rxdt-list" });
  const actionsPane = el(doc, "section", { className: "rxdt-actions" }, [
    filterInput,
    list,
  ]);

  const tabButtons: Record<DetailTab, HTMLButtonElement> = {
    action: button("Action", () => setTab("action")),
    state: button("State", () => setTab("state")),
    diff: button("Diff", () => setTab("diff")),
  };
  const tabs = el(doc, "div", { className: "rxdt-tabs" }, [
    tabButtons.action,
    tabButtons.state,
    tabButtons.diff,
  ]);
  const detail = el(doc, "div", { className: "rxdt-detail" });
  const detailsPane = el(doc, "section", { className: "rxdt-details" }, [
    tabs,
    detail,
  ]);
  const main = el(doc, "div", { className: "rxdt-main" }, [
    actionsPane,
    detailsPane,
  ]);

  // ----- footer -------------------------------------------------------------

  const prevButton = button("Prev", () => step(-1), "Previous state");
  const playButton = button("Play", () => togglePlay(), "Replay the history");
  const nextButton = button("Next", () => step(1), "Next state");
  const slider = el(doc, "input", {
    className: "rxdt-slider",
    attrs: {
      type: "range",
      min: "0",
      max: "0",
      value: "0",
      "aria-label": "Current state",
    },
  });
  slider.addEventListener("input", () =>
    command((store) => store.devtools.jumpToState(Number(slider.value))),
  );
  const status = el(doc, "span", { className: "rxdt-status" });
  const footer = el(doc, "footer", { className: "rxdt-footer" }, [
    prevButton,
    playButton,
    nextButton,
    slider,
    status,
  ]);

  const root = el(doc, "div", {
    className: "rxdt",
    attrs: { role: "region", "aria-label": title },
  });
  root.append(header, main, footer);
  container.appendChild(root);

  // ----- behaviour ------------------------------------------------------------

  function setTab(next: DetailTab): void {
    tab = next;
    render();
  }

  function step(delta: number): void {
    const liftedState = current()?.liftedState;
    if (!liftedState) {
      return;
    }
    const last = liftedState.computedStates.length - 1;
    const index = Math.min(
      last,
      Math.max(0, liftedState.currentStateIndex + delta),
    );
    if (index !== liftedState.currentStateIndex) {
      command((store) => store.devtools.jumpToState(index));
    }
  }

  function stopPlay(): void {
    if (playTimer !== undefined) {
      clearInterval(playTimer);
      playTimer = undefined;
    }
    playButton.textContent = "Play";
    playButton.classList.remove("is-on");
  }

  function togglePlay(): void {
    if (playTimer !== undefined) {
      stopPlay();
      return;
    }
    const liftedState = current()?.liftedState;
    if (!liftedState || liftedState.computedStates.length < 2) {
      return;
    }
    if (
      liftedState.currentStateIndex >=
      liftedState.computedStates.length - 1
    ) {
      command((store) => store.devtools.jumpToState(0));
    }
    playButton.textContent = "Stop";
    playButton.classList.add("is-on");
    playTimer = setInterval(() => {
      const state = current()?.liftedState;
      if (
        !state ||
        state.currentStateIndex >= state.computedStates.length - 1
      ) {
        stopPlay();
        return;
      }
      command((store) =>
        store.devtools.jumpToState(state.currentStateIndex + 1),
      );
    }, PLAY_INTERVAL);
  }

  function exportState(): void {
    const instance = current();
    const view = doc.defaultView;
    if (
      !instance?.liftedState ||
      !view ||
      typeof view.URL.createObjectURL !== "function"
    ) {
      return;
    }
    const blob = new view.Blob([safeStringify(instance.liftedState)], {
      type: "application/json",
    });
    const url = view.URL.createObjectURL(blob);
    const link = el(doc, "a", {
      attrs: {
        href: url,
        download: `${active}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      },
    });
    link.click();
    view.URL.revokeObjectURL(url);
  }

  function importFile(): void {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    file
      .text()
      .then((text) => {
        const next = JSON.parse(text) as AnyLiftedState;
        command((store) => store.devtools.importState(next));
      })
      .catch((error: unknown) => {
        console.warn("rxjs-devtools: could not import the history", error);
      })
      .finally(() => {
        fileInput.value = "";
      });
  }

  function selectedIndex(liftedState: AnyLiftedState): number {
    const index =
      selectedId === undefined
        ? -1
        : liftedState.stagedActionIds.indexOf(selectedId);
    return index === -1
      ? Math.min(
          liftedState.currentStateIndex,
          liftedState.computedStates.length - 1,
        )
      : index;
  }

  // ----- rendering --------------------------------------------------------------

  function renderInstances(): void {
    const names = [...instances.keys()];
    instanceSelect.replaceChildren(
      ...names.map((name) =>
        el(doc, "option", { text: name, attrs: { value: name } }),
      ),
    );
    if (active !== undefined) {
      instanceSelect.value = active;
    }
    instanceSelect.hidden = names.length < 2;
  }

  function renderToolbar(liftedState: AnyLiftedState | undefined): void {
    const enabled = liftedState !== undefined;
    for (const control of [
      pauseButton,
      lockButton,
      commitButton,
      revertButton,
      sweepButton,
      resetButton,
      exportButton,
      importButton,
      prevButton,
      playButton,
      nextButton,
      slider,
    ]) {
      control.disabled = !enabled;
    }
    pauseButton.textContent = liftedState?.isPaused ? "Resume" : "Pause";
    pauseButton.classList.toggle("is-on", Boolean(liftedState?.isPaused));
    lockButton.textContent = liftedState?.isLocked ? "Unlock" : "Lock";
    lockButton.classList.toggle("is-on", Boolean(liftedState?.isLocked));
    sweepButton.disabled =
      !liftedState || liftedState.skippedActionIds.length === 0;
    popOutButton.disabled = instances.size === 0;
  }

  function renderList(liftedState: AnyLiftedState): void {
    const {
      stagedActionIds,
      actionsById,
      skippedActionIds,
      computedStates,
      currentStateIndex,
    } = liftedState;
    const needle = filter.trim().toLowerCase();
    const rows: HTMLElement[] = [];
    let previous: PerformAction<Action> | undefined;
    const start = Math.max(0, stagedActionIds.length - MAX_ROWS);

    stagedActionIds.forEach((id, index) => {
      const entry = actionsById[id] as PerformAction<Action> | undefined;
      const type = entry ? String(entry.action.type) : `#${id}`;
      const time = formatTime(entry, previous);
      previous = entry;
      if (index < start || (needle && !type.toLowerCase().includes(needle))) {
        return;
      }
      const skipped = skippedActionIds.includes(id);
      const row = el(doc, "li", {
        className: classes(
          "rxdt-row",
          index === currentStateIndex && "is-current",
          skipped && "is-skipped",
          id === selectedId && "is-selected",
          Boolean(computedStates[index]?.error) && "has-error",
        ),
        attrs: { "data-action-id": String(id) },
        onClick: () => {
          selectedId = id;
          render();
        },
      });
      const rowActions = el(doc, "div", { className: "rxdt-row-actions" }, [
        button(
          "Jump",
          (event) => {
            event.stopPropagation();
            command((store) => store.devtools.jumpToAction(id));
          },
          "Jump to this state",
        ),
      ]);
      if (index > 0) {
        rowActions.append(
          button(
            skipped ? "Unskip" : "Skip",
            (event) => {
              event.stopPropagation();
              command((store) => store.devtools.toggleAction(id));
            },
            "Toggle this action",
          ),
        );
      }
      row.append(
        el(doc, "span", { className: "rxdt-row-id", text: String(id) }),
        el(doc, "span", {
          className: "rxdt-row-type",
          text: type,
          title: type,
        }),
        el(doc, "span", { className: "rxdt-row-time", text: time }),
        rowActions,
      );
      rows.push(row);
    });

    list.replaceChildren(...rows);
    const currentRow = rows.find((row) => row.classList.contains("is-current"));
    if (currentRow && typeof currentRow.scrollIntoView === "function") {
      currentRow.scrollIntoView({ block: "nearest" });
    }
  }

  function renderDetail(liftedState: AnyLiftedState): void {
    for (const [name, control] of Object.entries(tabButtons)) {
      control.classList.toggle("is-on", name === tab);
    }
    const index = selectedIndex(liftedState);
    const id = liftedState.stagedActionIds[index];
    const computed = liftedState.computedStates[index];
    detail.replaceChildren();

    if (tab === "action") {
      const entry = liftedState.actionsById[id] as
        PerformAction<Action> | undefined;
      detail.append(el(doc, "pre", { text: safeStringify(entry?.action) }));
      return;
    }
    if (tab === "state") {
      if (computed?.error) {
        detail.append(
          el(doc, "div", { className: "rxdt-error", text: computed.error }),
        );
      }
      detail.append(el(doc, "pre", { text: safeStringify(computed?.state) }));
      return;
    }
    const before =
      index > 0
        ? liftedState.computedStates[index - 1]?.state
        : liftedState.committedState;
    const entries = diffStates(before, computed?.state);
    if (entries.length === 0) {
      detail.append(
        el(doc, "div", { className: "rxdt-empty", text: "No changes" }),
      );
      return;
    }
    const table = el(doc, "table", { className: "rxdt-diff" });
    for (const entry of entries) {
      const change =
        entry.kind === "added"
          ? previewValue(entry.after)
          : entry.kind === "removed"
            ? previewValue(entry.before)
            : `${previewValue(entry.before)} → ${previewValue(entry.after)}`;
      table.append(
        el(doc, "tr", {}, [
          el(doc, "td", { text: entry.path }),
          el(doc, "td", { className: entry.kind, text: entry.kind }),
          el(doc, "td", { text: change }),
        ]),
      );
    }
    detail.append(table);
  }

  function renderFooter(liftedState: AnyLiftedState): void {
    const last = Math.max(0, liftedState.computedStates.length - 1);
    const index = Math.min(liftedState.currentStateIndex, last);
    slider.max = String(last);
    slider.value = String(index);
    const flags = [
      liftedState.skippedActionIds.length > 0 &&
        `${liftedState.skippedActionIds.length} skipped`,
      liftedState.isPaused && "paused",
      liftedState.isLocked && "locked",
    ].filter(Boolean);
    status.textContent = `${index} / ${last}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
  }

  function render(): void {
    if (destroyed) {
      return;
    }
    renderInstances();
    const liftedState = current()?.liftedState;
    renderToolbar(liftedState);
    if (!liftedState) {
      list.replaceChildren(
        el(doc, "li", {
          className: "rxdt-empty",
          text:
            instances.size === 0
              ? "No store attached. Call panel.attach(name, store)."
              : "Waiting for the first state.",
        }),
      );
      detail.replaceChildren();
      slider.max = "0";
      slider.value = "0";
      status.textContent = "";
      return;
    }
    renderList(liftedState);
    renderDetail(liftedState);
    renderFooter(liftedState);
  }

  // ----- public API ---------------------------------------------------------------

  function attach<S, A extends Action>(
    name: string,
    store: InstrumentedStore<S, A>,
  ): () => void {
    if (destroyed) {
      return () => undefined;
    }
    detach(name);
    // The panel only reads state and issues commands, so it can treat every
    // store uniformly.
    const anyStore = store as unknown as AnyStore;
    const instance: Instance = {
      store: anyStore,
      unsubscribe: () => undefined,
    };
    const subscription = anyStore.liftedState$.subscribe({
      next: (liftedState) => {
        instance.liftedState = liftedState;
        if (active === name) {
          render();
        }
      },
      error: () => detach(name),
      complete: () => detach(name),
    });
    if (subscription.closed) {
      return () => undefined;
    }
    instance.unsubscribe = () => subscription.unsubscribe();
    instances.set(name, instance);
    if (active === undefined) {
      active = name;
    }
    render();
    forEachLinked((panel) => panel.attach(name, store));
    return () => detach(name);
  }

  function detach(name: string): void {
    const instance = instances.get(name);
    if (!instance) {
      return;
    }
    instance.unsubscribe();
    instances.delete(name);
    if (active === name) {
      active = instances.keys().next().value;
      selectedId = undefined;
      stopPlay();
    }
    render();
    forEachLinked((panel) => panel.detach(name));
  }

  function select(name: string): void {
    if (!instances.has(name) || name === active) {
      return;
    }
    active = name;
    selectedId = undefined;
    stopPlay();
    render();
  }

  function popOut(
    windowOptions: DevtoolsWindowOptions = {},
  ): DevtoolsPanel | null {
    const panel = openDevtoolsWindow({ title, ...windowOptions });
    if (!panel) {
      return null;
    }
    for (const [name, instance] of instances) {
      panel.attach(name, instance.store);
    }
    linked.add(panel);
    return panel;
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    stopPlay();
    for (const instance of instances.values()) {
      instance.unsubscribe();
    }
    instances.clear();
    linked.clear();
    root.remove();
    destroyed = true;
  }

  render();

  return {
    element: root,
    get instances() {
      return [...instances.keys()];
    },
    get destroyed() {
      return destroyed;
    },
    attach,
    detach,
    select,
    popOut,
    destroy,
  };
}

const windowPanels = new WeakMap<Window, DevtoolsPanel>();

/**
 * Opens an RxJS DevTools panel in its own browser window, titled and iconed
 * as such. Returns `null` when the popup was blocked, so call it from a user
 * gesture such as a button click. Calling it again while the window is open
 * focuses it and returns the same panel.
 */
export function openDevtoolsWindow(
  options: DevtoolsWindowOptions = {},
): DevtoolsPanel | null {
  if (typeof window === "undefined") {
    return null;
  }
  const title = options.title ?? DEFAULT_PANEL_TITLE;
  const popup = window.open(
    "",
    options.name ?? "rxjs-devtools",
    options.features ?? "popup,width=960,height=640",
  );
  if (!popup) {
    return null;
  }
  const existing = windowPanels.get(popup);
  if (existing) {
    popup.focus();
    return existing;
  }

  const doc = popup.document;
  // The window can outlive a reload of the opener while the WeakMap does
  // not, so replace whatever a previous page left behind instead of stacking
  // a second panel on top of it.
  doc.body.replaceChildren();
  doc.title = title;
  doc.documentElement.lang = "en";
  let favicon = doc.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = doc.createElement("link");
    favicon.rel = "icon";
    doc.head.appendChild(favicon);
  }
  favicon.type = "image/svg+xml";
  favicon.href = RXJS_DEVTOOLS_ICON_DATA_URI;
  doc.body.style.margin = "0";
  doc.body.style.height = "100vh";

  const inner = createDevtoolsPanel({ container: doc.body, title });
  inner.element.style.borderRadius = "0";
  inner.element.style.border = "none";

  const panel: DevtoolsPanel = {
    element: inner.element,
    get instances() {
      return inner.instances;
    },
    get destroyed() {
      return inner.destroyed;
    },
    attach: (name, store) => inner.attach(name, store),
    detach: (name) => inner.detach(name),
    select: (name) => inner.select(name),
    popOut: (windowOptions) => inner.popOut(windowOptions),
    destroy: () => {
      inner.destroy();
      windowPanels.delete(popup);
      if (!popup.closed) {
        popup.close();
      }
    },
  };
  windowPanels.set(popup, panel);
  popup.addEventListener("pagehide", () => {
    inner.destroy();
    windowPanels.delete(popup);
  });
  // A reload or navigation of the opener would leave a window with stale
  // data. Unsubscribe right away, but close the window from the popup's own
  // event loop rather than from inside the opener's unload handler.
  window.addEventListener(
    "pagehide",
    () => {
      inner.destroy();
      windowPanels.delete(popup);
      popup.setTimeout(() => {
        if (!popup.closed) {
          popup.close();
        }
      }, 0);
    },
    { once: true },
  );
  return panel;
}
