# vio

Vue custom renderer ecosystem for native GTK4 apps on Node.js 24.

- pnpm workspaces live in `packages/*`; keep the root package private. New packages get their own manifests, exports, tests, and release versions.
- Install with `vp install --frozen-lockfile`. Use Vite+ for formatting (`vp fmt`, the only formatter).
- Run `vp run check`; real GTK tests: `vp run test:gtk` with a desktop display or `xvfb-run`.
- FEOD applies to every source/example root: expose module APIs through `index.ts`; register new roots in `feod.config.mjs`.
- Never commit generated `dist`, local credentials, or native dependencies.
- Publish from `.github/workflows/publish.yml` through npm OIDC; see `docs/releasing.md`. Never add an npm write token to CI.
