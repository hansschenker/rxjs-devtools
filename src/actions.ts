import type { Action } from "./types";
import type { LiftedState } from "./reducer";

/*
 * The action types below are part of the Redux DevTools extension protocol:
 * the extension dispatches `{ type: "JUMP_TO_STATE", index }`,
 * `{ type: "TOGGLE_ACTION", id }`, ... when you time-travel in its UI. They
 * therefore keep the exact names and payload shapes used by
 * `@ngrx/store-devtools` and `redux-devtools-instrument`.
 */
export const PERFORM_ACTION = "PERFORM_ACTION";
export const REFRESH = "REFRESH";
export const RESET = "RESET";
export const ROLLBACK = "ROLLBACK";
export const COMMIT = "COMMIT";
export const SWEEP = "SWEEP";
export const TOGGLE_ACTION = "TOGGLE_ACTION";
export const SET_ACTIONS_ACTIVE = "SET_ACTIONS_ACTIVE";
export const JUMP_TO_STATE = "JUMP_TO_STATE";
export const JUMP_TO_ACTION = "JUMP_TO_ACTION";
export const IMPORT_STATE = "IMPORT_STATE";
export const LOCK_CHANGES = "LOCK_CHANGES";
export const PAUSE_RECORDING = "PAUSE_RECORDING";

/**
 * An application action lifted into the history. `actionsById` of the
 * `LiftedState` is a map of these.
 */
export interface PerformAction<A extends Action = Action> {
  readonly type: typeof PERFORM_ACTION;
  readonly action: A;
  readonly timestamp: number;
}

export interface Refresh {
  readonly type: typeof REFRESH;
}

export interface Reset {
  readonly type: typeof RESET;
  readonly timestamp: number;
}

export interface Rollback {
  readonly type: typeof ROLLBACK;
  readonly timestamp: number;
}

export interface Commit {
  readonly type: typeof COMMIT;
  readonly timestamp: number;
}

export interface Sweep {
  readonly type: typeof SWEEP;
}

export interface ToggleAction {
  readonly type: typeof TOGGLE_ACTION;
  readonly id: number;
}

export interface SetActionsActive {
  readonly type: typeof SET_ACTIONS_ACTIVE;
  readonly start: number;
  readonly end: number;
  readonly active: boolean;
}

export interface JumpToState {
  readonly type: typeof JUMP_TO_STATE;
  readonly index: number;
}

export interface JumpToAction {
  readonly type: typeof JUMP_TO_ACTION;
  readonly actionId: number;
}

export interface ImportState<S = unknown, A extends Action = Action> {
  readonly type: typeof IMPORT_STATE;
  readonly nextLiftedState: LiftedState<S, A>;
}

export interface LockChanges {
  readonly type: typeof LOCK_CHANGES;
  readonly status: boolean;
}

export interface PauseRecording {
  readonly type: typeof PAUSE_RECORDING;
  readonly status: boolean;
}

/**
 * Every action understood by the lifted reducer that originates from the
 * devtools (as opposed to the application).
 */
export type HistoryAction<S = unknown, A extends Action = Action> =
  | PerformAction<A>
  | Refresh
  | Reset
  | Rollback
  | Commit
  | Sweep
  | ToggleAction
  | SetActionsActive
  | JumpToState
  | JumpToAction
  | ImportState<S, A>
  | LockChanges
  | PauseRecording;

export function performAction<A extends Action>(
  action: A,
  timestamp: number = Date.now(),
): PerformAction<A> {
  if (typeof action.type === "undefined") {
    throw new Error(
      'Actions may not have an undefined "type" property. ' +
        "Have you misspelled a constant?",
    );
  }
  return { type: PERFORM_ACTION, action, timestamp };
}

export function refresh(): Refresh {
  return { type: REFRESH };
}

export function reset(timestamp: number = Date.now()): Reset {
  return { type: RESET, timestamp };
}

export function rollback(timestamp: number = Date.now()): Rollback {
  return { type: ROLLBACK, timestamp };
}

export function commit(timestamp: number = Date.now()): Commit {
  return { type: COMMIT, timestamp };
}

export function sweep(): Sweep {
  return { type: SWEEP };
}

export function toggleAction(id: number): ToggleAction {
  return { type: TOGGLE_ACTION, id };
}

export function setActionsActive(
  start: number,
  end: number,
  active = true,
): SetActionsActive {
  return { type: SET_ACTIONS_ACTIVE, start, end, active };
}

export function jumpToState(index: number): JumpToState {
  return { type: JUMP_TO_STATE, index };
}

export function jumpToAction(actionId: number): JumpToAction {
  return { type: JUMP_TO_ACTION, actionId };
}

export function importState<S, A extends Action>(
  nextLiftedState: LiftedState<S, A>,
): ImportState<S, A> {
  return { type: IMPORT_STATE, nextLiftedState };
}

export function lockChanges(status: boolean): LockChanges {
  return { type: LOCK_CHANGES, status };
}

export function pauseRecording(status: boolean): PauseRecording {
  return { type: PAUSE_RECORDING, status };
}
