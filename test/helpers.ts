import { vi, type Mock } from "vitest";

import type {
  ExtensionMessage,
  ReduxDevtoolsExtension,
  ReduxDevtoolsExtensionConfig,
  ReduxDevtoolsExtensionConnection,
} from "../src/redux-devtools";
import type { Action } from "../src/types";

export interface MockConnection extends ReduxDevtoolsExtensionConnection {
  init: Mock<(state?: unknown) => void>;
  subscribe: Mock<(listener: (message: ExtensionMessage) => void) => void>;
  unsubscribe: Mock<() => void>;
  send: Mock<(action: unknown, state: unknown) => void>;
  error: Mock<(message: unknown) => void>;
}

export interface MockExtension extends ReduxDevtoolsExtension {
  connect: Mock<
    (options: ReduxDevtoolsExtensionConfig) => ReduxDevtoolsExtensionConnection
  >;
  send: Mock<
    (
      action: unknown,
      state: unknown,
      options?: ReduxDevtoolsExtensionConfig,
    ) => void
  >;
}

export interface MockDevtools {
  extension: MockExtension;
  connection: MockConnection;
  /** Posts a message from the extension to every registered listener. */
  emit(message: ExtensionMessage): void;
  start(): void;
  stop(): void;
  /** Issues a history command (`JUMP_TO_STATE`, `TOGGLE_ACTION`, ...). */
  dispatchLifted(payload: unknown): void;
  /** Dispatches an application action from the extension's dispatcher UI. */
  dispatchAction(payload: unknown): void;
}

export function createMockDevtools(): MockDevtools {
  const connection: MockConnection = {
    init: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(),
    error: vi.fn(),
  };
  const extension: MockExtension = {
    connect: vi.fn(() => connection),
    send: vi.fn(),
  };
  const emit = (message: ExtensionMessage): void => {
    for (const [listener] of connection.subscribe.mock.calls) {
      listener(message);
    }
  };
  return {
    extension,
    connection,
    emit,
    start: () => emit({ type: "START" }),
    stop: () => emit({ type: "STOP" }),
    dispatchLifted: (payload) => emit({ type: "DISPATCH", payload }),
    dispatchAction: (payload) => emit({ type: "ACTION", payload }),
  };
}

export const counter = vi.fn((state: number = 0, action: Action): number => {
  switch (action.type) {
    case "INCREMENT":
      return state + 1;
    case "DECREMENT":
      return state - 1;
    default:
      return state;
  }
});

declare let mistake: number;

export function counterWithBug(state: number = 0, action: Action): number {
  switch (action.type) {
    case "INCREMENT":
      return state + 1;
    case "DECREMENT":
      return mistake - 1; // mistake is undefined
    default:
      return state;
  }
}

export function counterWithAnotherBug(
  state: number = 0,
  action: Action,
): number {
  switch (action.type) {
    case "INCREMENT":
      return mistake + 1;
    case "DECREMENT":
      return state - 1;
    default:
      return state;
  }
}

export function doubleCounter(state: number = 0, action: Action): number {
  switch (action.type) {
    case "INCREMENT":
      return state + 2;
    case "DECREMENT":
      return state - 2;
    default:
      return state;
  }
}
