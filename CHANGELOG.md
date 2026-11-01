# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.2] - 2026-11-01

### Added

- Declarative role containers in `packages/vio/src/modules/gtk/containers.ts`: `VNotebook`/`VNotebookPage`, `VPaned`, `VOverlay`, `VCenterBox`, `VHeaderBar`, `VFlowBox`, `VFixed` and `VListView`, each mapping named slots and `role` props to native placement.
- `WidgetDefinition.insertChild`/`removeChild` placement hooks, called with `{ parent, parentWidget, child, node, role, before, index }` after the controller branch and before the `children` mode switch.
- `hasWidget()`, `getWidgetDefinition()` and `getWidgetTypes()` exports for idempotent wrapper registration, plus optional `beginMount()`/`endMount()` driver hooks around `app.mount()`.
- `useNative()`, `useDetachedSlot()` and `defineContainerComponent()` helpers for native handles, detached role widgets and container components.
- `createRoot(widget, mode?)` accepts a `ChildrenMode` or a registered type and infers the mode of `Box`, `ListBox`, `Grid`, `Stack`, `Notebook`, `Paned`, `Overlay`, `CenterBox`, `HeaderBar`, `FlowBox` and `Fixed`.
- Named-root registry (`registerRoot`, `unregisterRoot`, `getRoot`, `getRootNames`, `queryRoot`) so `Teleport` resolves `#name` targets; an internal `div` storage container backed by a detached `Gtk.Box` backs `KeepAlive`.
- Generic `gtk-<class>` elements resolved from GObject Introspection (`resolveIntrospected`, `listIntrospectedWidgetTypes`, `isIntrospectedType`), with explicit registrations taking precedence and an explicit single-child allowlist instead of method probing.
- Construct-only property support: `WidgetDefinition.constructProps` passes `GParamFlags.CONSTRUCT_ONLY` values to `create()`, and introspection generates the same list per class.
- Wave 1 controls: `VToggleButton`, `VLinkButton`, `VMenuButton`, `VPopover`, `VPopoverMenu`, `VPopoverMenuBar`, `VExpander`, `VProgressBar`, `VLevelBar`, `VScale`, `VSpinButton`, `VDropDown`, `VComboBoxText`, `VPasswordEntry`, `VStackSwitcher`, `VStackSidebar`.
- Wave 2 data and panel widgets: `VColumnView`/`VColumnViewColumn`, `VGridView`, `VIconView`, `VTextView`, `VEditableLabel`, `VSearchEntry`, `VInscription`, `VSearchBar`, `VActionBar`, `VInfoBar`, `VStatusbar`, `VTreeView`/`VTreeViewColumn`, `VListModel`, plus `useListModel`, `useStringList`, `useFilterListModel`, `useSortListModel` and the single/multi/no-selection helpers.
- Wave 3 windows and dialogs: `VApplicationWindow`, `VAssistant`/`VAssistantPage`, `VDialog`, `VMessageDialog`, `VFileChooserDialog`, `VFileChooserNative`, `VColorChooserDialog`, `VFontChooserDialog`, `VAppChooserDialog`, `VPrintUnixDialog`, `VPageSetupUnixDialog`, `VAboutDialog`, and the Promise controllers `VAlertDialog`, `VFileDialog`, `VColorDialog`, `VFontDialog`.
- Wave 4 media and value pickers: `VPicture`, `VVideo`, `VMediaControls`, `VMediaFile`, `VDrawingArea`, `VGLArea`, `VColorButton`, `VFontButton`, `VColorDialogButton`, `VFontDialogButton`, `VCalendar`, `VStringList`, `VFilterListModel`, `VSortListModel`.
- Wave 5 small and special widgets: `VFrame`, `VViewport`, `VAspectFrame`, `VRevealer`, `VScrollbar`, `VScaleButton`, `VVolumeButton`, `VLockButton`, `VPopoverBin`, `VEmojiChooser`, `VShortcutLabel`, `VTreeExpander`, `VSvgWidget`, `VWindowControls`, `VWindowHandle`, `VColorChooserWidget`, `VFontChooserWidget`, `VGraphicsOffload`.
- Wave 6 AppChooser widgets: `VAppChooserButton` and `VAppChooserWidget`, which pass `content-type` through the constructor and expose `handle.error`/`handle.available` for invalid values.
- TreeView columns and cell renderers: `VTreeViewColumn`, `VCellRendererText`, `VCellRendererToggle`, `VCellRendererPixbuf` and `createTreeListModel()`.
- Shortcuts dialogs: `VShortcutsWindow`, `VShortcutsSection`, `VShortcutsGroup` and `VShortcutsShortcut`.
- `VFontDialog` accepts a `font-desc` prop (`Pango.FontDescription` or font-name string) that `chooseFont(parent)` uses when no initial argument is passed.
- Documentation: `docs/containers.md`, `docs/controls.md`, `docs/data.md`, `docs/dialogs.md`, `docs/media.md`, `docs/small.md`, `docs/widgets.md`, a rewritten `docs/limitations.md` and a new `docs/limitations-research.md`.
- Demos and FEOD roots: `examples/showcase`, `examples/generic`, `examples/controls`, `examples/data`, `examples/dialogs`, `examples/media`, `examples/small`, with matching `demo:*` scripts.
- GTK test suites `containers`, `widgets-generic`, `controls`, `data`, `dialogs`, `media`, `small` and `app-chooser`, wired into `test:gtk`, and `packages/vio/.node-version` pinning the Node 24 ABI used by `node-gtk`.

### Changed

- `registerWidget()` validates `children` against the closed mode union, rejects non-function `insertChild`/`removeChild`, and validates `constructProps` as an array of strings.
- Replacing a `:model`, `:factory`, `:file`, `:menu-model`, `:application`, `:settings`, `:paintable`, `:media-stream`, `:dialog`, `:permission`, `:popover`, `:list-row`, `:adjustment`, `:label-widget` or `:stylesheet` binding clears it through the dedicated GTK setter instead of `setProperty(name, null)`, which node-gtk rejects.
- The SFC compiler parses `gtk-*` tags as custom elements and allows `v-model` only on the components that declare the matching prop and update event, with a reworded compile error.
- `getWidgetTypes()` keeps the existing registration order and each wave appends its explicit `vio-*` types; wave 4 components resolve introspected classes without new registrations.
- `VWindow` gains explicit `title`, `default-width`, `default-height`, `modal`, `resizable`, `decorated`, `transient-for` and `destroy-with-parent` props, a cancellable `@close-request`, and destroys the native window on unmount.
- `createRoot()` without a mode keeps the legacy `single` inference for unknown GTK classes; introspected `gtk-*` roots use the resolved definition instead.
- `KeepAlive` works without user registration through the internal `div` fallback; `hasWidget("div")` stays `false` and an explicit registration overrides the fallback.
- Package scripts: `test:gtk` runs all new suites and the `demo:*` entries cover the new examples; the package README and root README document the containers, generic widgets, dialogs, native handles and the Node 24 pin.
- `docs/limitations-research.md` records `@zede/vio` 0.7.2 as the version of the examined code; the code is unchanged, only the version label follows this release.

### Fixed

- Keyed moves in `VHeaderBar`: `#start` and `#end` follow VNode order through `Gtk.Box.insertChildAfter()`/`reorderChildAfter()`, and only the moved wrapper changes position, keeping GObject identity and focus.
- Keyed moves in `VOverlay`: every `#overlay` child is its own layer, added in VNode order and removable without touching the remaining layers.
- Keyed moves in `VFlowBox`: a move reinserts the existing `GtkFlowBoxChild` wrapper, so the content widget and its CSS survive; a real removal still detaches the content.
- Keyed moves in `VShortcutsGroup`: shortcut rows are reordered with `reorderChildAfter()`/`insertChildAfter()` while the internal title label stays first; sections and groups remain append-only.
- Synthetic slot wrappers release their content when they leave a role container, and window content and titlebar are cleared around destruction, so unmounting does not leave user widgets parented to a dead box.
- Window `visible: true` is deferred while a subtree is still mounting, so `setTitlebar()` always runs before realization; the titlebar slot is cleared only after `destroy()`, avoiding GTK's realized-window warning.
- GTK tests assert real parents for the single-child allowlist (with the documented Gizmo/PopoverContent exceptions) and verify GL rendering in a child process instead of soft `rootOf()` checks.
- Documentation facts: `VFontDialog` resolves a real `Pango.FontDescription` once a font is selected (the `No Fonts Found` label exists but is unmapped), and the GL section states that node-gtk 4.1.1 exposes no callable OpenGL entry points, so the test draws with Cairo.
