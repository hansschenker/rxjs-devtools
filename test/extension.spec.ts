import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  PERFORM_ACTION,
  performAction,
  type PerformAction,
} from "../src/actions";
import { createConfig, DEFAULT_NAME, type DevtoolsConfig } from "../src/config";
import {
  createExtensionBridge,
  ExtensionActionTypes,
  type ExtensionBridge,
} from "../src/extension";
import type {
  ComputedState,
  DevtoolsAction,
  LiftedActions,
  LiftedState,
} from "../src/reducer";
import type {
  DevtoolsFeatureOptions,
  ReduxDevtoolsExtensionConfig,
} from "../src/redux-devtools";
import type { Action } from "../src/types";
import { unliftState } from "../src/utils";
import { createMockDevtools, type MockDevtools } from "./helpers";

type State = unknown;

function createOptions(
  name = DEFAULT_NAME,
  features: DevtoolsFeatureOptions = {
    pause: true,
    lock: true,
    persist: true,
    export: true,
    import: "custom",
    jump: true,
    skip: true,
    reorder: true,
    dispatch: true,
    test: true,
  },
  serialize: boolean | undefined = false,
  maxAge: false | number = false,
  autoPause = false,
  trace = false,
  traceLimit = 75,
): ReduxDevtoolsExtensionConfig {
  const options: ReduxDevtoolsExtensionConfig = {
    name,
    features,
    serialize,
    autoPause,
    trace,
    traceLimit,
  };
  if (maxAge !== false /* support === 0 */) {
    options.maxAge = maxAge;
  }
  return options;
}

function createState(
  actionsById?: LiftedActions<Action>,
  computedStates?: ComputedState<State>[],
  isLocked = false,
  isPaused = false,
): LiftedState<State, Action> {
  return {
    monitorState: null,
    nextActionId: 1,
    actionsById: actionsById || {
      0: {
        type: PERFORM_ACTION,
        action: { type: "SOME_ACTION" },
        timestamp: 0,
      },
    },
    stagedActionIds: [0],
    skippedActionIds: [],
    committedState: { count: 0 },
    currentStateIndex: 0,
    computedStates: computedStates || [
      {
        state: 1,
        error: null,
      },
    ],
    isLocked,
    isPaused,
  };
}

// A lifted action that is not a PERFORM_ACTION and therefore requires a full
// state update.
const FULL_UPDATE_ACTION = { type: "REFRESH" } as DevtoolsAction<State, Action>;

function testSetup(config: DevtoolsConfig<State, Action>): MockDevtools & {
  bridge: ExtensionBridge<State, Action>;
} {
  const mock = createMockDevtools();
  const bridge = createExtensionBridge(mock.extension, config);
  return { ...mock, bridge };
}

const bookRented = Object.assign(
  (props: { id: number; customerId: number }) => ({
    type: "[Books] Rent",
    ...props,
  }),
  { type: "[Books] Rent" },
);
const bookReturned = Object.assign(
  (props: { id: number }) => ({ type: "[Books] Return", ...props }),
  { type: "[Books] Return" },
);
const allBooksReturned = Object.assign(() => ({ type: "[Books] Return All" }), {
  type: "[Books] Return All",
});
const booksSearched = Object.assign(
  (query: string, page: number) => ({ type: "[Books] Search", query, page }),
  { type: "[Books] Search" },
);

describe("createExtensionBridge", () => {
  function myActionSanitizer(action: Action): Action {
    return action;
  }

  function myStateSanitizer(state: State): State {
    return state;
  }

  it("should connect with default options", () => {
    const { bridge, extension } = testSetup(createConfig({}));
    // Subscription needed or else extension connection will not be established.
    bridge.actions$.subscribe(() => null);
    const defaultOptions = createOptions();
    expect(extension.connect).toHaveBeenCalledWith(defaultOptions);
  });

  it("should init the connection once it is established", () => {
    const { bridge, connection, extension } = testSetup(createConfig({}));
    expect(extension.connect).not.toHaveBeenCalled();
    const subscription = bridge.liftedActions$.subscribe(() => null);
    expect(extension.connect).toHaveBeenCalledTimes(1);
    expect(connection.init).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    expect(connection.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("should share one connection between all streams", () => {
    const { bridge, extension } = testSetup(createConfig({}));
    bridge.actions$.subscribe(() => null);
    bridge.liftedActions$.subscribe(() => null);
    bridge.start$.subscribe(() => null);
    expect(extension.connect).toHaveBeenCalledTimes(1);
  });

  it("should connect with given options", () => {
    const { bridge, extension } = testSetup(
      createConfig({
        name: "rxjs-devtools-todolist",
        maxAge: 10,
        serialize: true,
        autoPause: true,
        // these two should not be added
        actionSanitizer: myActionSanitizer,
        stateSanitizer: myStateSanitizer,
        trace: true,
        traceLimit: 20,
      }),
    );
    bridge.actions$.subscribe(() => null);
    const options = createOptions(
      "rxjs-devtools-todolist",
      undefined,
      true,
      10,
      true,
      true,
      20,
    );
    expect(extension.connect).toHaveBeenCalledWith(options);
  });

  it("should connect with given action creators", () => {
    const { bridge, extension } = testSetup(
      createConfig({ actionCreators: [bookRented, bookReturned] }),
    );
    bridge.actions$.subscribe(() => null);
    expect(extension.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCreators: [
          { name: "[Books] Rent", func: bookRented, args: ["props"] },
          { name: "[Books] Return", func: bookReturned, args: ["props"] },
        ],
      }),
    );
  });

  it("should connect with action creators named by record keys", () => {
    const { bridge, extension } = testSetup(
      createConfig({
        actionCreators: {
          rentBook: bookRented,
          returnAllBooks: allBooksReturned,
          searchBooks: booksSearched,
        },
      }),
    );
    bridge.actions$.subscribe(() => null);
    expect(extension.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCreators: [
          { name: "rentBook", func: bookRented, args: ["props"] },
          { name: "returnAllBooks", func: allBooksReturned, args: [] },
          { name: "searchBooks", func: booksSearched, args: ["query", "page"] },
        ],
      }),
    );
  });

  it("should not add action creators to the connect options when not provided", () => {
    const { bridge, extension } = testSetup(createConfig({}));
    bridge.actions$.subscribe(() => null);
    const [connectOptions] = extension.connect.mock.calls[0];
    expect(connectOptions).not.toHaveProperty("actionCreators");
  });

  it("should connect with custom serializer", () => {
    const customSerializer = {
      replacer: (_key: string, value: unknown) => value,
    };
    const { bridge, extension } = testSetup(
      createConfig({
        name: "rxjs-devtools-todolist",
        serialize: customSerializer,
      }),
    );
    bridge.actions$.subscribe(() => null);
    expect(extension.connect).toHaveBeenCalledWith(
      expect.objectContaining({ serialize: customSerializer }),
    );
  });

  for (const { payload, name } of [
    {
      payload: "{type: '[Books] Rent', id: 5, customerId: 12}",
      name: "evaluates payload because of string",
    },
    {
      payload: { type: "[Books] Rent", id: 5, customerId: 12 },
      name: "passes payload through if not of type string",
    },
  ]) {
    it(`should handle an unlifted action (dispatched by DevTools) - ${name}`, () => {
      const { bridge, emit } = testSetup(createConfig({}));
      let unwrappedAction: Action | undefined = undefined;
      bridge.actions$.subscribe((action) => {
        unwrappedAction = action;
      });

      emit({ type: ExtensionActionTypes.START });
      emit({ type: ExtensionActionTypes.ACTION, payload });
      expect(unwrappedAction).toEqual({
        type: "[Books] Rent",
        id: 5,
        customerId: 12,
      });
    });
  }

  it("should ignore actions before START and after STOP", () => {
    const { bridge, emit } = testSetup(createConfig({}));
    const seen: Action[] = [];
    const lifted: DevtoolsAction<State, Action>[] = [];
    bridge.actions$.subscribe((action) => seen.push(action));
    bridge.liftedActions$.subscribe((action) => lifted.push(action));

    emit({ type: ExtensionActionTypes.ACTION, payload: { type: "early" } });
    emit({ type: ExtensionActionTypes.START });
    emit({ type: ExtensionActionTypes.ACTION, payload: { type: "in-time" } });
    emit({
      type: ExtensionActionTypes.DISPATCH,
      payload: { type: "JUMP_TO_STATE", index: 1 },
    });
    emit({ type: ExtensionActionTypes.STOP });
    emit({ type: ExtensionActionTypes.ACTION, payload: { type: "late" } });
    emit({
      type: ExtensionActionTypes.DISPATCH,
      payload: { type: "JUMP_TO_STATE", index: 2 },
    });

    expect(seen).toEqual([{ type: "in-time" }]);
    expect(lifted).toEqual([{ type: "JUMP_TO_STATE", index: 1 }]);
  });

  describe("actions dispatched with configured action creators", () => {
    function dispatchFromExtension(
      config: DevtoolsConfig<State, Action>,
      payload: unknown,
    ): Action | undefined {
      const { bridge, emit } = testSetup(config);
      let unwrappedAction: Action | undefined = undefined;
      bridge.actions$.subscribe((action) => {
        unwrappedAction = action;
      });
      emit({ type: ExtensionActionTypes.START });
      emit({ type: ExtensionActionTypes.ACTION, payload });
      return unwrappedAction;
    }

    it("should create the action with the entered props", () => {
      const unwrappedAction = dispatchFromExtension(
        createConfig({ actionCreators: [bookRented, allBooksReturned] }),
        {
          name: "[Books] Rent(props)",
          selected: 0,
          args: ["{ id: 5, customerId: 12 }"],
          rest: "",
        },
      );
      expect(unwrappedAction).toEqual({
        type: "[Books] Rent",
        id: 5,
        customerId: 12,
      });
    });

    it("should create an action without props", () => {
      const unwrappedAction = dispatchFromExtension(
        createConfig({ actionCreators: [bookRented, allBooksReturned] }),
        { name: "[Books] Return All()", selected: 1, args: [], rest: "" },
      );
      expect(unwrappedAction).toEqual({ type: "[Books] Return All" });
    });

    it("should create an action from a function-style creator with rest args", () => {
      const unwrappedAction = dispatchFromExtension(
        createConfig({ actionCreators: { searchBooks: booksSearched } }),
        {
          name: "searchBooks(args)",
          selected: 0,
          args: [],
          rest: '["tolkien", 3]',
        },
      );
      expect(unwrappedAction).toEqual({
        type: "[Books] Search",
        query: "tolkien",
        page: 3,
      });
    });

    it("should pass the payload through when the selected index is unknown", () => {
      const payload = { name: "unknown()", selected: 99, args: [], rest: "" };
      const unwrappedAction = dispatchFromExtension(
        createConfig({ actionCreators: [bookRented] }),
        payload,
      );
      expect(unwrappedAction).toEqual(payload);
    });
  });

  describe("notify", () => {
    it("should send notification with default options", () => {
      const { bridge, extension } = testSetup(createConfig({}));
      const defaultOptions = createOptions();
      const state = createState();
      bridge.notify(FULL_UPDATE_ACTION, state);
      expect(extension.send).toHaveBeenCalledWith(null, state, defaultOptions);
    });

    it("should send notification with given options", () => {
      const { bridge, extension } = testSetup(
        createConfig({
          name: "rxjs-devtools-todolist",
          maxAge: 10,
          serialize: true,
          // these two should not be added
          actionSanitizer: myActionSanitizer,
          stateSanitizer: myStateSanitizer,
        }),
      );

      const options = createOptions(
        "rxjs-devtools-todolist",
        undefined,
        true,
        10,
      );
      const state = createState();
      bridge.notify(FULL_UPDATE_ACTION, state);
      expect(extension.send).toHaveBeenCalledWith(null, state, options);
    });

    it("should not send a fast update before the connection exists", () => {
      const { bridge, extension, connection } = testSetup(createConfig({}));
      bridge.notify(performAction({ type: "A" }), createState());
      expect(connection.send).not.toHaveBeenCalled();
      expect(extension.send).not.toHaveBeenCalled();
    });

    describe("[with Action and State Sanitizer]", () => {
      const UNSANITIZED_TOKEN = "UNSANITIZED_ACTION";
      const SANITIZED_TOKEN = "SANITIZED_ACTION";
      const SANITIZED_COUNTER = 42;

      function createPerformAction(): PerformAction<Action> {
        return performAction({ type: UNSANITIZED_TOKEN }, 1234567);
      }

      function testActionSanitizer(): Action {
        return { type: SANITIZED_TOKEN };
      }

      function testStateSanitizer(): number {
        return SANITIZED_COUNTER;
      }

      describe("should function normally with no sanitizers", () => {
        let setup: ReturnType<typeof testSetup>;

        beforeEach(() => {
          setup = testSetup(createConfig({}));
          setup.bridge.actions$.subscribe(() => null);
        });

        it("for normal action", () => {
          const action = createPerformAction();
          const state = createState();

          setup.bridge.notify(action, state);
          expect(setup.connection.send).toHaveBeenCalledWith(
            action,
            unliftState(state),
          );
        });

        it("for action that requires full state update", () => {
          const options = createOptions();
          const state = createState();

          setup.bridge.notify(FULL_UPDATE_ACTION, state);
          expect(setup.extension.send).toHaveBeenCalledWith(
            null,
            state,
            options,
          );
        });
      });

      describe("should run the action sanitizer on actions", () => {
        let setup: ReturnType<typeof testSetup>;

        beforeEach(() => {
          setup = testSetup(
            createConfig({ actionSanitizer: testActionSanitizer }),
          );
          setup.bridge.actions$.subscribe(() => null);
        });

        it("for normal action", () => {
          const action = createPerformAction();
          const state = createState();
          const sanitizedAction = {
            ...action,
            action: testActionSanitizer(),
          };

          setup.bridge.notify(action, state);
          expect(setup.connection.send).toHaveBeenCalledWith(
            sanitizedAction,
            unliftState(state),
          );
        });

        it("for action that requires full state update", () => {
          const options = createOptions();
          const state = createState();
          const sanitizedState = createState({
            0: {
              type: PERFORM_ACTION,
              action: { type: SANITIZED_TOKEN },
              timestamp: 0,
            },
          });

          setup.bridge.notify(FULL_UPDATE_ACTION, state);
          expect(setup.extension.send).toHaveBeenCalledWith(
            null,
            sanitizedState,
            options,
          );
        });
      });

      describe("should run the state sanitizer on store state", () => {
        let setup: ReturnType<typeof testSetup>;

        beforeEach(() => {
          setup = testSetup(
            createConfig({ stateSanitizer: testStateSanitizer }),
          );
          setup.bridge.actions$.subscribe(() => null);
        });

        it("for normal action", () => {
          const action = createPerformAction();
          const state = createState();
          const sanitizedState = createState(undefined, [
            { state: SANITIZED_COUNTER, error: null },
          ]);

          setup.bridge.notify(action, state);
          expect(setup.connection.send).toHaveBeenCalledWith(
            action,
            unliftState(sanitizedState),
          );
        });

        it("for action that requires full state update", () => {
          const options = createOptions();
          const state = createState();
          const sanitizedState = createState(undefined, [
            { state: SANITIZED_COUNTER, error: null },
          ]);

          setup.bridge.notify(FULL_UPDATE_ACTION, state);
          expect(setup.extension.send).toHaveBeenCalledWith(
            null,
            sanitizedState,
            options,
          );
        });
      });

      describe("sanitizers should not modify original state or actions", () => {
        let setup: ReturnType<typeof testSetup>;

        beforeEach(() => {
          setup = testSetup(
            createConfig({
              actionSanitizer: testActionSanitizer,
              stateSanitizer: testStateSanitizer,
            }),
          );
          setup.bridge.actions$.subscribe(() => null);
        });

        it("for normal action", () => {
          const action = createPerformAction();
          const state = createState();

          setup.bridge.notify(action, state);
          expect(state).toEqual(createState());
          expect(action).toEqual(createPerformAction());
        });

        it("for action that requires full state update", () => {
          const state = createState();

          setup.bridge.notify(FULL_UPDATE_ACTION, state);
          expect(state).toEqual(createState());
          expect(FULL_UPDATE_ACTION).toEqual({ type: "REFRESH" });
        });
      });
    });

    describe("with Action and actionsBlocklist", () => {
      const NORMAL_ACTION = "[Test] NORMAL_ACTION";
      const BLOCKED_ACTION_1 = "[Test] BLOCKED_ACTION #1";
      const BLOCKED_ACTION_2 = "[Test] BLOCKED_ACTION #2";

      let setup: ReturnType<typeof testSetup>;

      beforeEach(() => {
        setup = testSetup(
          createConfig({
            actionsBlocklist: [BLOCKED_ACTION_1, BLOCKED_ACTION_2],
          }),
        );
        setup.bridge.actions$.subscribe(() => null);
      });

      it("should ignore the blocked action", () => {
        const state = createState();

        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        setup.bridge.notify(performAction({ type: BLOCKED_ACTION_1 }), state);
        setup.bridge.notify(performAction({ type: BLOCKED_ACTION_2 }), state);

        expect(setup.connection.send).toHaveBeenCalledTimes(2);
      });
    });

    describe("with Action and actionsSafelist", () => {
      const NORMAL_ACTION = "[Test] NORMAL_ACTION";
      const SAFE_ACTION_1 = "[Test] SAFE_ACTION #1";
      const SAFE_ACTION_2 = "[Test] SAFE_ACTION #2";

      let setup: ReturnType<typeof testSetup>;

      beforeEach(() => {
        setup = testSetup(
          createConfig({ actionsSafelist: [SAFE_ACTION_1, SAFE_ACTION_2] }),
        );
        setup.bridge.actions$.subscribe(() => null);
      });

      it("should only keep the safe action", () => {
        const state = createState();

        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        setup.bridge.notify(performAction({ type: SAFE_ACTION_1 }), state);
        setup.bridge.notify(performAction({ type: SAFE_ACTION_2 }), state);

        expect(setup.connection.send).toHaveBeenCalledTimes(2);
      });
    });

    describe("with Action and predicate", () => {
      const NORMAL_ACTION = "NORMAL_ACTION";
      const RANDOM_ACTION = "RANDOM_ACTION";

      const predicate = vi.fn((_state: State, action: Action) => {
        return action.type !== RANDOM_ACTION;
      });

      let setup: ReturnType<typeof testSetup>;

      beforeEach(() => {
        predicate.mockClear();
        setup = testSetup(createConfig({ predicate }));
        setup.bridge.actions$.subscribe(() => null);
      });

      it("should ignore action according to predicate", () => {
        const state = createState();

        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        expect(predicate).toHaveBeenCalledWith(unliftState(state), {
          type: NORMAL_ACTION,
        });
        setup.bridge.notify(performAction({ type: NORMAL_ACTION }), state);
        setup.bridge.notify(performAction({ type: RANDOM_ACTION }), state);
        expect(predicate).toHaveBeenCalledTimes(3);
        expect(setup.connection.send).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("with locked recording", () => {
    let setup: ReturnType<typeof testSetup>;

    beforeEach(() => {
      setup = testSetup(createConfig({}));
      setup.bridge.actions$.subscribe(() => null);
    });

    it("should not notify extension of PERFORM_ACTIONs", () => {
      const action = performAction({ type: "ACTION" });
      const state = createState(undefined, undefined, true);

      setup.bridge.notify(action, state);
      expect(setup.connection.send).not.toHaveBeenCalled();
      expect(setup.extension.send).not.toHaveBeenCalled();
    });

    it("should notify extension of actions that require full state update", () => {
      const state = createState(undefined, undefined, true);
      const options = createOptions();

      setup.bridge.notify(FULL_UPDATE_ACTION, state);
      expect(setup.connection.send).not.toHaveBeenCalled();
      expect(setup.extension.send).toHaveBeenCalledWith(null, state, options);
    });
  });

  describe("with paused recording", () => {
    let setup: ReturnType<typeof testSetup>;

    beforeEach(() => {
      setup = testSetup(createConfig({}));
      setup.bridge.actions$.subscribe(() => null);
    });

    it("should not notify extension of PERFORM_ACTIONs", () => {
      const action = performAction({ type: "ACTION" });
      const state = createState(undefined, undefined, undefined, true);

      setup.bridge.notify(action, state);
      expect(setup.connection.send).not.toHaveBeenCalled();
      expect(setup.extension.send).not.toHaveBeenCalled();
    });

    it("should notify extension of actions that require full state update", () => {
      const state = createState(undefined, undefined, undefined, true);
      const options = createOptions();

      setup.bridge.notify(FULL_UPDATE_ACTION, state);
      expect(setup.connection.send).not.toHaveBeenCalled();
      expect(setup.extension.send).toHaveBeenCalledWith(null, state, options);
    });
  });

  describe("error handling", () => {
    let consoleSpy: MockInstance;
    let setup: ReturnType<typeof testSetup>;

    beforeEach(() => {
      setup = testSetup(createConfig({}));
      setup.bridge.actions$.subscribe();
      consoleSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
    });

    it("for normal action", () => {
      setup.connection.send.mockImplementation(() => {
        throw new Error("uh-oh something went wrong");
      });

      setup.bridge.notify(
        performAction({ type: "FOO" }, 1234567),
        createState(),
      );
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("for action that requires full state update", () => {
      setup.extension.send.mockImplementation(() => {
        throw new Error("uh-oh something went wrong");
      });

      setup.bridge.notify(FULL_UPDATE_ACTION, createState());
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("without an extension", () => {
    it("exposes empty streams and an inert notify", () => {
      const bridge = createExtensionBridge<State, Action>(
        null,
        createConfig({}),
      );
      const completed: string[] = [];
      bridge.actions$.subscribe({ complete: () => completed.push("actions$") });
      bridge.liftedActions$.subscribe({
        complete: () => completed.push("liftedActions$"),
      });
      bridge.start$.subscribe({ complete: () => completed.push("start$") });
      expect(completed).toEqual(["actions$", "liftedActions$", "start$"]);
      expect(() =>
        bridge.notify(performAction({ type: "A" }), createState()),
      ).not.toThrow();
    });
  });
});
