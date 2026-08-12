import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts", "components/index": "src/components/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  splitting: false,
  outDir: "dist",
  platform: "node",
  noExternal: [/.*/],
  external: ["preact", "preact/hooks", "preact/jsx-runtime", "preact/compat", "vfile", "unified", "@jackyzha0/quartz"],
  esbuildOptions(options) {
    options.jsx = "automatic"
    options.jsxImportSource = "preact"
  },
})
