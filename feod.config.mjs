import { libraryLayers } from "@o-feod/oxlint-structure-plugin/presets";

export default {
  rootDefault: {
    ignore: [
      "node_modules/**",
      "**/dist/**",
      "**/tests/**",
      "scripts/**",
      "docs/**",
      "**/*.config.*",
      "feod.config.mjs",
    ],
    imports: { computed: "forbid", unresolved: "forbid" },
    cycles: { modules: true, types: "include" },
    modules: { publicEntries: ["index.ts"], requirePublicEntry: true },
    inventory: { uncovered: true },
  },
  roots: {
    "packages/vio/src": { layers: libraryLayers },
    "packages/vio/examples/counter": {},
    "packages/vio/examples/showcase": {},
    "packages/vio/examples/generic": {},
    "packages/vio/examples/controls": {},
    "packages/vio/examples/data": {},
  },
};
