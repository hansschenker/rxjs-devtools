import { describe, expect, it } from "vitest";

import {
  createConfig,
  DEFAULT_FEATURES,
  DEFAULT_NAME,
  defaultOnError,
  noMonitor,
} from "../src/config";
import type { Action } from "../src/types";

const defaultFeatures = {
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
};

const defaults = {
  maxAge: false,
  monitor: noMonitor,
  actionSanitizer: undefined,
  stateSanitizer: undefined,
  actionCreators: undefined,
  name: DEFAULT_NAME,
  serialize: false,
  logOnly: false,
  autoPause: false,
  trace: false,
  traceLimit: 75,
  features: defaultFeatures,
  onError: defaultOnError,
};

describe("createConfig", () => {
  it("creates default options with empty object given", () => {
    expect(createConfig({})).toEqual(defaults);
  });

  it("creates default options when nothing is given", () => {
    expect(createConfig()).toEqual(defaults);
  });

  it("creates options that contain passed in options", () => {
    function stateSanitizer(state: unknown): unknown {
      return state;
    }
    function actionSanitizer(action: Action): Action {
      return action;
    }
    const actionCreators = [() => ({ type: "[Counter] Increment" })];
    const onError = (): void => undefined;
    const config = createConfig({
      maxAge: 20,
      actionSanitizer,
      stateSanitizer,
      name: "ABC",
      serialize: true,
      autoPause: true,
      trace: true,
      traceLimit: 20,
      features: { test: true },
      actionCreators,
      onError,
      extension: null,
    });
    expect(config).toEqual({
      ...defaults,
      maxAge: 20,
      actionSanitizer,
      stateSanitizer,
      name: "ABC",
      serialize: true,
      autoPause: true,
      trace: true,
      traceLimit: 20,
      features: { test: true },
      actionCreators,
      onError,
      extension: null,
    });
  });

  it("can be initialized with a function returning options", () => {
    expect(createConfig(() => ({ maxAge: 15 }))).toEqual({
      ...defaults,
      maxAge: 15,
    });
  });

  it("logOnly will set features", () => {
    expect(createConfig({ logOnly: true })).toEqual({
      ...defaults,
      logOnly: true,
      features: { pause: true, export: true, test: true },
    });
  });

  it('import "true" is updated to "custom"', () => {
    expect(createConfig({ features: { import: true } })).toEqual({
      ...defaults,
      features: { import: "custom" },
    });
  });

  it("copies the feature flags so they can be mutated per instance", () => {
    const config = createConfig({});
    config.features.jump = false;
    expect(DEFAULT_FEATURES.jump).toBe(true);
    expect(createConfig({}).features.jump).toBe(true);
  });

  it("throws when maxAge is less than 2", () => {
    expect(() => createConfig({ maxAge: 1 })).toThrowError(
      /cannot be less than/,
    );
    expect(() => createConfig({ maxAge: 0 })).toThrowError(
      /cannot be less than/,
    );
  });
});
