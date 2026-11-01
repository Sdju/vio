# vio

Vue custom renderer for native GTK4 applications on Node.js. Vue owns components, reactivity, slots and lifecycle; GTK renders native widgets without a DOM or WebView.

This repository is a **pnpm workspace** for the vio ecosystem. The root is private; each package has its own exports, dependencies and release version.

| Package                               | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| [`@zede/vio`](packages/vio/README.md) | GTK renderer, Vue widget components, SFC compiler and Node loader |

## Quick start

Install the public package:

```bash
npm install @zede/vio node-gtk
node --import @zede/vio/register main.ts
```

See the [package guide](packages/vio/README.md) for a complete counter application, widget API and supported Vue features, and [declarative layer limitations](docs/limitations.md) for the limits of the widget tree.

## Development

Use Node.js 24 (pinned in `.node-version`), [Vite+](https://viteplus.dev), GTK4 and GObject Introspection. `node-gtk` may need Python 3, make and a C++ compiler if no native prebuild is available.

`packages/vio` carries its own `.node-version` because package scripts run from that directory, where Vite+ resolves the Node version, and `node-gtk` is built for the Node 24 ABI. Do not delete it or raise the Node major without rebuilding the `node-gtk` binding.

On Ubuntu 24.04:

```bash
sudo apt-get install build-essential python3 pkg-config libgtk-4-dev libgirepository1.0-dev gir1.2-gtk-4.0 xvfb dbus-x11
vp install --frozen-lockfile
vp run check
vp run test:gtk
vp run --filter @zede/vio demo
```

Without an interactive display, run GTK checks through `dbus-run-session -- xvfb-run -a`. CI validates Linux and installs the packed library into a separate consumer project before exercising real GTK widgets. Other platforms require their own GTK installation; this standalone repository does not yet have macOS/Windows CI.

Oxfmt through `vp fmt` is the only formatter. FEOD enforces module boundaries through public `index.ts` entry points.

## Workspace structure

```text
packages/
  vio/               # @zede/vio
scripts/              # architecture, archive smoke test and release tooling
docs/releasing.md     # npm OIDC setup and publishing
docs/limitations.md   # declarative layer limits
.github/workflows/    # checks and manual publishing
```

Add ecosystem packages under `packages/*` with independent manifests and versions. Root build/test/typecheck tasks select workspace packages by directory. Register each new source/example root in `feod.config.mjs` and configure an npm trusted publisher for every public package.

## Releases

[Publishing guide](docs/releasing.md): GitHub Actions → npm trusted publishing with OIDC and provenance, without an npm write token in repository secrets. The workflow accepts a workspace package name and defaults to dry run.

## Origin and license

Extracted from [Projector](https://github.com/Sdju/projector), starting from `41d525fd37f1732f1b9c340a3cb3530b0190dd37` and the subsequent `@zede/vio` scope migration. The package code retains its existing MIT license. See [LICENSE](LICENSE).
