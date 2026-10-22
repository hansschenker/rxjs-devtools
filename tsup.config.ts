import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    panel: "src/panel/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: ["rxjs"],
});
