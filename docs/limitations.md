# Declarative layer limitations

This document describes the current state of the declarative layer in `@zede/vio` 0.7.x. It replaces
the earlier version, whose conclusions were too strong: most role containers and native
resources are now expressible with ordinary Vue components and props. The remaining limits are
listed honestly at the end.

Everything reachable imperatively through a component ref or its `.widget` object is still reachable;
GTK and node-gtk are not the limiting factor.

## ChildrenMode and placement hooks

`ChildrenMode` is still a closed union: `none | box | single | list | grid | stack | text`
(`packages/vio/src/modules/gtk/types.ts`). A user extension still cannot add a new branch to the
mode switch. Two things changed:

1. `registerWidget()` now validates `children`. An unknown string throws
   `vio: unknown children mode '…' for '…'` instead of silently dropping every child.
2. `WidgetDefinition` gained two optional hooks that replace the mode switch for a container:

```ts
export interface Placement {
  parent: VioElement;
  parentWidget: Gtk.Widget;
  child: Gtk.Widget;
  node: VioNode;
  role: string | null; // node.props.role
  before: Gtk.Widget | null; // null for role slots
  index: number; // among widget-backed, non-controller siblings
}
export interface WidgetDefinition {
  create: (props?: Record<string, unknown>) => object;
  children?: ChildrenMode;
  controller?: boolean;
  constructProps?: string[]; // kebab-case names, applied by create()
  insertChild?: (placement: Placement) => void;
  removeChild?: (placement: Placement) => void;
}
```

Hook dispatch happens in `gtkDriver.insert()` after the controller branch and before `childMode()`,
and in `gtkDriver.remove()` after the controller branch. A definition with an `insertChild` hook owns
all widget placement for that parent.

The hooks come with rules that container authors must follow:

- Role slots read `node.props.role`. Anchors (`before`) are `null` for role children because the flat
  VNode sibling list does not describe named slots.
- A repeated insert is a **move**, not an append. The hook sees a child that is already parented and
  must reorder or move it (`Notebook.reorderChild`, `Fixed.move`, remove+reinsert the existing
  `GtkFlowBoxChild` for `FlowBox`).
- Removal must be **idempotent**. Vue does not guarantee removal order, and a full subtree teardown
  may skip individual `remove` calls.
- Hooks must be functions; `registerWidget()` rejects any other value.
- `hasWidget(type)` and `getWidgetDefinition(type)` are exported so wrapper libraries can register
  once, without a duplicate-registration crash.

### Construct-only properties

GTK has properties that may only be passed to the constructor (`GParamFlags.CONSTRUCT_ONLY`).
Calling `setProperty()` afterwards either does nothing (`setContentType()` is a no-op) or logs
`GLib-GObject-CRITICAL: construct property "content-type" … can't be set after construction`.
`WidgetDefinition` therefore has a second, optional creation path:

```ts
export interface WidgetDefinition {
  // `props` contains only the names listed in `constructProps`, keyed by their camelCase
  // node-gtk constructor names: constructProps: ["content-type"] -> { contentType }.
  create: (props?: Record<string, unknown>) => object;
  /** Kebab-case property names that must go to the constructor. */
  constructProps?: string[];
}
```

The renderer passes the VNode props to `createElement()`, so `VioDriver.create(type, props?)`
receives them before the widget is inserted:

- A definition that declares `constructProps` gets a filtered `props` object in `create()`. The
  filter accepts both `content-type` and `contentType` spellings in the VNode.
- Every other definition keeps `create: () => new Gtk.X()`; the optional argument is ignored.
- `patchProp()` still runs for the same key. When the value already matches the constructed
  property, the driver returns without calling `setProperty()`, so GTK never logs a critical.
- A real change after insertion throws
  `vio: '<type>' property '<name>' is construct-only and cannot change after the widget is inserted`.
  Before insertion (a manually built node or a renderer that creates elements before props), the
  driver recreates the widget with the accumulated props and rebinds its native signals. This is a
  compatibility path; Vue's normal `createElement(type, …, props)` path applies the value directly.
- `registerWidget()` validates `constructProps` as an array of strings.

Introspected `gtk-*` widgets use the same mechanism. `resolveIntrospected()` attaches a
`constructProps` list generated from GObject Introspection, so
`<gtk-app-chooser-button content-type="image/png" />` and `VAppChooserButton` behave identically.
The universal `Gtk.Widget:css-name` property is construct-only for every class; the table below
lists it plus the class-specific extras for all 105 `Gtk.Widget` subclasses on GTK 4.24.1.

| Class                    | Construct-only properties                     |
| ------------------------ | --------------------------------------------- |
| `about-dialog`           | css-name                                      |
| `action-bar`             | css-name                                      |
| `app-chooser-button`     | css-name, content-type                        |
| `app-chooser-dialog`     | css-name, content-type, use-header-bar, gfile |
| `app-chooser-widget`     | css-name, content-type                        |
| `application-window`     | css-name                                      |
| `aspect-frame`           | css-name                                      |
| `assistant`              | css-name, use-header-bar                      |
| `box`                    | css-name                                      |
| `button`                 | css-name                                      |
| `calendar`               | css-name                                      |
| `cell-view`              | css-name, cell-area, cell-area-context        |
| `center-box`             | css-name                                      |
| `check-button`           | css-name                                      |
| `color-button`           | css-name                                      |
| `color-chooser-dialog`   | css-name, use-header-bar                      |
| `color-chooser-widget`   | css-name                                      |
| `color-dialog-button`    | css-name                                      |
| `column-view`            | css-name                                      |
| `combo-box`              | css-name, has-entry                           |
| `combo-box-text`         | css-name, has-entry                           |
| `dialog`                 | css-name, use-header-bar                      |
| `drag-icon`              | css-name                                      |
| `drawing-area`           | css-name                                      |
| `drop-down`              | css-name                                      |
| `editable-label`         | css-name                                      |
| `emoji-chooser`          | css-name                                      |
| `entry`                  | css-name                                      |
| `expander`               | css-name                                      |
| `file-chooser-dialog`    | css-name, use-header-bar                      |
| `file-chooser-widget`    | css-name                                      |
| `fixed`                  | css-name                                      |
| `flow-box`               | css-name                                      |
| `flow-box-child`         | css-name                                      |
| `font-button`            | css-name                                      |
| `font-chooser-dialog`    | css-name, use-header-bar                      |
| `font-chooser-widget`    | css-name                                      |
| `font-dialog-button`     | css-name                                      |
| `frame`                  | css-name                                      |
| `gl-area`                | css-name                                      |
| `graphics-offload`       | css-name                                      |
| `grid`                   | css-name                                      |
| `grid-view`              | css-name                                      |
| `header-bar`             | css-name                                      |
| `icon-view`              | css-name, cell-area                           |
| `image`                  | css-name                                      |
| `info-bar`               | css-name                                      |
| `inscription`            | css-name                                      |
| `label`                  | css-name                                      |
| `level-bar`              | css-name                                      |
| `link-button`            | css-name                                      |
| `list-base`              | css-name                                      |
| `list-box`               | css-name                                      |
| `list-box-row`           | css-name                                      |
| `list-view`              | css-name                                      |
| `lock-button`            | css-name                                      |
| `media-controls`         | css-name                                      |
| `menu-button`            | css-name                                      |
| `message-dialog`         | css-name, use-header-bar, buttons             |
| `notebook`               | css-name                                      |
| `overlay`                | css-name                                      |
| `page-setup-unix-dialog` | css-name, use-header-bar                      |
| `paned`                  | css-name                                      |
| `password-entry`         | css-name                                      |
| `picture`                | css-name                                      |
| `popover`                | css-name                                      |
| `popover-bin`            | css-name                                      |
| `popover-menu`           | css-name                                      |
| `popover-menu-bar`       | css-name                                      |
| `print-unix-dialog`      | css-name, use-header-bar                      |
| `progress-bar`           | css-name                                      |
| `range`                  | css-name                                      |
| `revealer`               | css-name                                      |
| `scale`                  | css-name                                      |
| `scale-button`           | css-name                                      |
| `scrollbar`              | css-name                                      |
| `scrolled-window`        | css-name                                      |
| `search-bar`             | css-name                                      |
| `search-entry`           | css-name                                      |
| `separator`              | css-name                                      |
| `shortcut-label`         | css-name                                      |
| `shortcuts-group`        | css-name                                      |
| `shortcuts-section`      | css-name                                      |
| `shortcuts-shortcut`     | css-name                                      |
| `shortcuts-window`       | css-name                                      |
| `spin-button`            | css-name                                      |
| `spinner`                | css-name                                      |
| `stack`                  | css-name                                      |
| `stack-sidebar`          | css-name                                      |
| `stack-switcher`         | css-name                                      |
| `statusbar`              | css-name                                      |
| `svg-widget`             | css-name                                      |
| `switch`                 | css-name                                      |
| `text`                   | css-name                                      |
| `text-view`              | css-name                                      |
| `toggle-button`          | css-name                                      |
| `tree-expander`          | css-name                                      |
| `tree-view`              | css-name                                      |
| `video`                  | css-name                                      |
| `viewport`               | css-name                                      |
| `volume-button`          | css-name                                      |
| `widget`                 | css-name                                      |
| `window`                 | css-name                                      |
| `window-controls`        | css-name                                      |
| `window-handle`          | css-name                                      |

The table was produced with GObject Introspection (`Gtk.Widget.list_properties()` and
`GParamFlags.CONSTRUCT_ONLY`); the probe lives outside the repository, and the generated list is
embedded in `packages/vio/src/modules/gtk/introspected.ts` so the runtime does not need Python.

### Containers that are now declarative

| Container       | Implemented as                        | Placement API                                                |
| --------------- | ------------------------------------- | ------------------------------------------------------------ |
| `Gtk.Notebook`  | `VNotebook` + `VNotebookPage`         | `appendPage`, `reorderChild`, `setTabLabel`, `removePage`    |
| `Gtk.Paned`     | `VPaned`                              | `setStartChild` / `setEndChild`                              |
| `Gtk.Overlay`   | `VOverlay`                            | `setChild` / ordered `addOverlay` / `removeOverlay`          |
| `Gtk.HeaderBar` | `VHeaderBar` (also `role="titlebar"`) | `packStart` / `packEnd` / `setTitleWidget` / repack on moves |
| `Gtk.CenterBox` | `VCenterBox`                          | `setStartWidget` / `setCenterWidget` / `setEndWidget`        |
| `Gtk.FlowBox`   | `VFlowBox`                            | `append` / `insert` / `remove`; wrapper survives moves       |
| `Gtk.Fixed`     | `VFixed`                              | `put` / `move` / `remove`, positions from `x` / `y` props    |
| `Gtk.Window`    | existing `VWindow`                    | `setChild`, plus `setTitlebar` for `role="titlebar"`         |

The components live in `packages/vio/src/modules/gtk/containers.ts` and are exported from
`@zede/vio`. Details and examples: [`docs/containers.md`](containers.md).

Introspected `gtk-*` widgets are a separate mechanism: they use an explicit allowlist for `single`
children and default to `none`. See [`docs/widgets.md`](widgets.md) for the resolution rules, the
child-mode table and the difference from the explicit registry.

### What remains impossible here

- A new `ChildrenMode` **from user code** so that the built-in switch gains a branch. The switch is
  private. The supported extension point is `insertChild` / `removeChild`, which bypasses it.
- Multiple GTK natives produced by one VNode (for example page content and tab label from one node).
  `VNotebookPage` uses a `label` prop or a `#tab-label` slot and a detached root for the second
  widget; one node always maps to one native widget.

## Root child mode

`createRoot(widget, mode?)` now accepts either a `ChildrenMode` or a registered widget type.
Without an explicit mode the driver maps known GTK classes to registered definitions:

| GTK class   | Type used        |
| ----------- | ---------------- |
| `Box`       | `box`            |
| `ListBox`   | `list-box`       |
| `Grid`      | `grid`           |
| `Stack`     | `stack`          |
| `Notebook`  | `vio-notebook`   |
| `Paned`     | `vio-paned`      |
| `Overlay`   | `vio-overlay`    |
| `CenterBox` | `vio-center-box` |
| `HeaderBar` | `vio-header-bar` |
| `FlowBox`   | `vio-flow-box`   |
| `Fixed`     | `vio-fixed`      |

So `createRoot(new Gtk.Notebook())`, `createRoot(new Gtk.Paned())` and
`createRoot(new Gtk.FlowBox())` place children through the hooks instead of failing with
`setChild is not a function`. Unknown classes are resolved through introspection first: the root
uses the introspected definition, so `createRoot(new Gtk.Frame())` gets `single` and
`createRoot(new Gtk.Calendar())` gets `none`. Only non-introspected classes keep the legacy `single`
inference. See [`docs/widgets.md`](widgets.md#root-widgets).

An explicit **unknown** mode string throws `vio: unknown root child mode '…'` when the first child
is inserted. A `Gtk.Box` with no registered definition still falls back to `single`.

## Non-widget GObject

The property half of the old document was right, the conclusion was wrong. Native objects are
ordinary prop values:

| Property                            | Value                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `ListView` / `ColumnView` `model`   | `Gtk.SelectionModel` (`SingleSelection`/`MultiSelection`/`NoSelection`) |
| `ListView` / `ColumnView` `factory` | `Gtk.SignalListItemFactory` (a GObject, not a plain object)             |
| `Picture` / `Video` `file`          | `Gio.File`                                                              |
| `PopoverMenu` `menu-model`          | `Gio.MenuModel` / `Gio.Menu`                                            |

Two real traps remain:

1. **Deep `ref()` proxies native objects.** `ref(selection)` breaks with
   `Cannot convert value "[object Object]" to type GtkSelectionModel`. Use `shallowRef` or
   `useNative()`; a shallow ref never wraps its value.
2. **`setProperty(name, null)` is rejected by node-gtk.** The driver now clears nullable object
   properties through their dedicated setters (`setModel(null)`, `setFactory(null)`,
   `setFile(null)`, `setMenuModel(null)`, `setApplication(null)`, `setSettings(null)`). Removing a
   binding no longer throws.

`VListModel` is a declarative resource component: it owns a `Gio.ListStore`, a `Gtk.SingleSelection`
and a `Gtk.SignalListItemFactory`, renders nothing, and exposes them to a component ref. It syncs
its store from an `items: string[]` prop; place it next to `VListView` and pass
`model.selection` / `model.factory`. A JS array is kept beside the store because
`Gio.ListStore.find()` returns a GI out-parameter tuple, not an index.

Process-level objects (`Gtk.Application`, `Gio.SimpleAction`, `Gio.Settings`) still belong in
`setup`/entry modules, not in the widget tree. That is their correct home, not a renderer limit.

### What remains impossible here

- An **element node** backed by a non-widget. Element nodes always go through
  `create`/`insert`/`remove` and are assumed to be `Gtk.Widget`s. Use a null-rendering component.
- **Symbol-keyed props** as native properties. Vue skips symbol keys in `for...in`; string props or a
  directive's `created` hook are the supported markers.
- **Ownership** of a shared model/factory across components. Vue scope owns what `setup` creates;
  sharing needs a provider component or an explicit handle.

## Corrections to the previous document

| Previous statement                                            | Correction                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single` makes `Notebook`/`Paned` fail                        | Correct for `Notebook`/`Paned`/`CenterBox`; `Frame`, `Button`, `ScrolledWindow`, `ListBoxRow`, `CheckButton` and `Overlay` (main child) implement `setChild`. |
| `none` throws "as soon as a child is declared"                | It throws when a **widget-backed** node is inserted; comments, empty text and null-rendering components are transparent.                                      |
| `ListView` needs `Gio.ListStore`/`TreeListModel`              | GTK4 views take a `Gtk.SelectionModel`; wrap the store in `SingleSelection`/`MultiSelection`/`NoSelection`.                                                   |
| The factory and callbacks are "plain objects"                 | The factory is a GObject; callbacks are JS functions bridged as signal handlers.                                                                              |
| There is no template syntax and no place to create a resource | `:model`/`:factory`/`:menu-model`/`:file` are normal props; a null-rendering component with `provide`/`inject` is a valid owner.                              |
| "A model attribute receives a plain JavaScript value"         | A plain JS array fails; a native GObject succeeds. The traps are deep `ref()` proxies and `null` unset (now fixed).                                           |
| "A factory cannot be declared as a child"                     | A factory is a property, not a child; `:factory` works.                                                                                                       |
| Add `insertChild`/`removeChild`/`attach`; effort S            | Implemented `insertChild`/`removeChild`; roles come from `node.props.role`, so no reconciler change was needed.                                               |
| Add a resource node in the reconciler; effort M/L             | Not needed; components plus props cover it. `VListModel` is the convenience layer.                                                                            |

## Remaining limitations

These are real today and are not planned as renderer changes:

- **Wave 1 control boundaries.** `Gtk.DragIcon` stays out of the introspected `single` allowlist:
  `setChild()` realizes the icon and crashes without a drag surface, so it cannot be verified
  safely. `Gtk.ScaleButton` has no `setChild()` method. Both remain `none`.
- **Wave 2 collection views and factories.** `VColumnView` / `VGridView` take a `Gio.ListModel` and
  wrap it in a selection; `Gio.ListStore` itself is not a selection model. Columns are appended in
  declaration order and a later column goes to the end; reordering columns is not implemented.
  Each cell is rendered into a `Gtk.Box` host owned by the `Gtk.ListItem`, and the `#cell` / `#item`
  root must be a single GTK widget. On unmount the column factory and the view model are cleared, so
  JS callbacks do not stay referenced by live GObjects.
- **`VIconView` is legacy.** `Gtk.IconView:model` is a `Gtk.TreeModel`, not a `Gio.ListModel`, and
  the widget paints cell renderers from model columns. There is no item factory and no widget cells,
  so `#item` throws. `markup-column` (and the raw `.widget`) are the supported surface; use
  `VGridView` for widget cells.
- **`Gtk.TreeListModel` is not a `Gtk.TreeModel`.** On GTK 4.24 it implements only `Gio.ListModel`
  (`GObject.typeIsA` is false for `GtkTreeModel`), so `createTreeListModel()` feeds a `VColumnView`
  through a selection, not `VTreeView`. `VTreeView` keeps taking a real `Gtk.TreeModel`.
- **Deprecated upstream.** `Gtk.TreeView`, `Gtk.Statusbar`, `Gtk.InfoBar` and `Gtk.IconView` are
  deprecated since GTK 4.10. The wrappers work on 4.24 and are documented as compatibility
  surfaces; new code should prefer `VColumnView`, `VGridView` and a regular `VBox`.
- **`VSearchEntry#search` has no native counterpart.** GTK4 removed `GtkSearchEntry::search`, and
  `search-changed` applies GTK's own 150 ms delay. The component proxies the immediate
  `GtkEditable::changed` signal (coalescing a synchronous delete/insert burst in a microtask), so
  `@search` is undebounced; debouncing is the caller's responsibility.
- **`VSearchBar` is outside the SFC `v-model` allowlist.** `search-mode-enabled` is two-way through
  `:search-mode-enabled` + `@update:search-mode-enabled`; `v-model:search-mode-enabled` is rejected
  at compile time. The wave 2 allowlist entries are only the components with a real `v-model`
  (`VTextView`, `VEditableLabel`, `VSearchEntry`, `VColumnView`, `VGridView`, `VIconView`).
- **`VInfoBar` action area.** `Gtk.InfoBar.addActionWidget()` accepts only activatable widgets, so
  `#action` is routed widget-by-widget and cannot be a generic multi-widget box. Use one button (or
  another activatable widget) per action item.
- **`VTextView` batches buffer signals.** `Gtk.TextBuffer.setText()` emits a delete/insert pair
  synchronously; the component publishes the final text in a microtask so `v-model:text` does not
  see the intermediate empty state. This is a microtask, not a timer-based debounce.
- **`VEditableLabel` equality guard.** The component writes `text` only when it differs from
  `getText()`. An external `setText()` with the same value still emits `notify::text`; the handler
  compares before emitting `update:text`, so an equal prop update does not move the caret.
- **`v-model` allowlist in SFC.** The compiler accepts `v-model` only for `VEntry` and the control,
  data, dialog and wave-4 components listed in the compiler allowlist (`docs/controls.md`,
  `docs/data.md`, `docs/media.md`). A third-party component that declares `modelValue` still needs
  an explicit compiler allowlist entry; use GTK properties and signals until then.
- **`VComboBoxText` items are strings.** `items: string[]` appends each string as both id and label.
  Custom ids or non-string rows need `append(id, label)` on the exposed `.widget`.
- **`VScale` value goes through its adjustment.** node-gtk does not expose `Gtk.Scale:value` through
  `getProperty()` / `setProperty()`, so the component writes to `Gtk.Adjustment` instead. Read the
  value from `scale.getValue()` or bind `v-model:value`.
- **`VMenuButton` `#popover` creates the popover.** The slot supplies popover content only. For
  custom `relative-to` / pointing configuration, create a `Gtk.Popover` in `setup`, keep it in
  `useNative()`, and pass it through the `popover` prop.
- **Stack switchers need an existing stack.** `VStackSwitcher` / `VStackSidebar` throw
  `vio: … requires a stack prop` by design. A template ref is populated after the first mount, so
  guard the switcher with `v-if="stack?.widget"` when the stack is a sibling component.
- **Adding a `ChildrenMode`** from user code (see above). Use placement hooks or a wrapper.
- **`setProperty(name, null)`** for an object property that is not in the driver's setter table.
  The table covers `model`, `factory`, `file`, `menu-model`, `application`, `settings`, `paintable`,
  `media-stream` and `dialog`; other object properties need their own setter in a `watch`.
- **Symbol props** as GTK properties.
- **Arbitrary `Teleport` selectors.** String targets resolve only through the named-root registry:
  `registerRoot("name", root)` plus `to="#name"`. CSS selectors and DOM lookup are not implemented.
  Pass a `VioElement` (or use `useDetachedSlot`) for any other target.
- **Custom GObject properties** on a `registerClass` subclass. node-gtk exposes vfuncs, not property
  installation.
- **Full-subtree teardown.** Vue calls `driver.remove` for individually removed children but not for
  every descendant of a fully unmounted subtree; descendants are disposed with their parent. Role
  containers therefore rely on GTK destruction or on the removed subtree becoming unreachable. When
  a page or slot is removed **while the container stays mounted**, the hooks detach it explicitly.
  A `Gtk.Window` unmount destroys the window before clearing its (now unrealized) titlebar slot, so
  GTK does not warn about `setTitlebar()` on a realized window.
- **`HeaderBar` internal parenting.** `packStart`/`packEnd` place children inside an internal
  `GtkBox`, not directly under the header bar. Membership checks therefore walk ancestors, not
  `getParent()`. A keyed move repacks the affected role group because GTK has no insert-at-index;
  widget identity is preserved, but focus inside that group may be reset.
- **String enum table.** Only the enums in `driver.ts` accept strings; other enums must be passed as
  GI integers.
- **No HTML layout engine.** DOM directives (`v-html`, `v-text`), DOM event modifiers, CSS
  preprocessors, external SFC blocks and browser transitions remain unsupported.

## Wave 3: windows and dialogs

The wave 3 components live in `packages/vio/src/modules/gtk/dialogs.ts`; the full API, response-id
rules and async cancellation contract are in [`dialogs.md`](dialogs.md). The non-obvious limits:

- **No nested main loops.** Async dialogs (`VAlertDialog`, `VFileDialog`, `VColorDialog`,
  `VFontDialog`) return Promises and rely on the caller's existing GLib loop. A blocking `run()` on
  a `Gtk.Dialog` is not exposed; tests and applications use `GLib.MainLoop`/`MainContext`.
- **Async dialogs need a live parent.** `choose(parent)`/`open(parent)` throw
  `vio: … requires a Gtk.Window parent` or `vio: … parent window has been destroyed`. Liveness is
  checked with `Gtk.Window.listToplevels()`, which includes unrealized windows and drops destroyed
  ones. There is no portal fallback and no "parent-less" async mode.
- **One pending operation per controller.** A second `choose()`/`open()` while the first is pending
  throws. `cancel()` or unmount resolves the Promise with `null` immediately and cancels the
  `Gio.Cancellable`; a late native callback is ignored, so cancellation never becomes an unhandled
  rejection or a hanging Promise.
- **`VFileDialog` parent workaround.** On GTK 4.24.1/X11, passing a realized parent to
  `gtk_file_dialog_open()` and cancelling immediately aborts the process. `VFileDialog` validates
  the parent but passes it to GTK only while the parent is unrealized; a realized parent yields an
  unparented native dialog. Color, font and alert dialogs pass the parent normally. This is a GTK
  defect verified on 4.24.1, not a renderer limit.
- **`Gtk.FileChooserDialog` needs realization for `response`.** On 4.24, `emit("response", …)` and
  button clicks on an unrealized file chooser do not reach the signal; presenting it works but
  emits unrelated GTK slider warnings in this environment. Tests inspect its properties and leave
  real interaction to a desktop session.
- **`VAppChooserDialog` construct-only props.** `content-type` and `gfile` cannot be set after
  construction (GLib-GObject-CRITICAL). The component owns the dialog and passes both to the
  constructor; later prop updates are not applied. Recreate it with a `key` to change them.
- **`VMessageDialog` buttons are added manually.** `Gtk.MessageDialog:buttons` is construct-only and
  not readable on 4.24. `VMessageDialog` creates the dialog with `NONE` and calls `addButton()` for
  the requested stock set; the labels are the English `OK`/`Cancel`/`Yes`/`No`/`Close` strings,
  not GTK's localized stock labels.
- **`VWindow` `@destroy` is not a GTK signal.** `Gtk.Widget::destroy` is `when=cleanup` /
  `no-hooks` on GTK 4.24 and cannot be connected. `VWindow` emits `@destroy` on unmount and from
  its exposed `destroy()` method; destroying the raw `.widget` directly cannot be observed.
- **Close-request return convention.** GTK uses `true` to keep a window open. `VWindow` also
  treats an explicit `false` as cancel (the wave 3 Vue convention) and treats `undefined` as
  "allow the default close". The handler always returns a boolean, avoiding node-gtk's
  `Cannot convert value "undefined" to type gboolean` error.
- **`VAssistant` current page.** `Gtk.Assistant:current-page` has no usable property notification
  on 4.24; `v-model:current-page` is driven from `::prepare`. `Gtk.Assistant::remove-page` leaves
  the removed page parented to GTK's internal `GtkStack`; the `vio-assistant` placement hook calls
  `unparent()` on the removed page so the subtree is released immediately (covered by a child-process
  test that asserts no `Gtk-CRITICAL`).
- **`VShortcutsWindow` is not wrapped.** The window is only a shell; its content is
  `ShortcutsSection`/`ShortcutsGroup` (internal display parts) and non-widget `Gtk.Shortcut`
  resources. Wrapping those would violate the wave 3 rule against wrapping internal parts, so the
  raw `gtk-shortcuts-window` element remains the escape hatch.
- **Portal and GtkBuildable behaviour.** `Gtk.FileDialog` still depends on the desktop portal/D-Bus.
  `GtkBuildable` XML, custom GObject properties and symbol props remain unsupported.
- **Deprecated wrappers.** `Gtk.Dialog`, `Gtk.MessageDialog`, `Gtk.FileChooserDialog`,
  `Gtk.FileChooserNative`, `Gtk.ColorChooserDialog`, `Gtk.FontChooserDialog`,
  `Gtk.AppChooserDialog` and `Gtk.Assistant` are deprecated since GTK 4.10. The wrappers work on
  4.24 and are documented compatibility surfaces. GTK 4.24 has no `close-response` signal on
  `Gtk.MessageDialog`; `VMessageDialog` synthesizes `@close-response` from
  `response == CLOSE | DELETE_EVENT`.

## Wave 4: media, canvas and value pickers

The components live in `packages/vio/src/modules/gtk/media.ts`; the API table and the full probe log
are in [`media.md`](media.md). The non-obvious limits:

- **`Gtk.CustomSorter` does not reach JavaScript.** node-gtk 4.1.1 marshals the `gconstpointer`
  arguments of `GtkCustomSorterFunc` as `undefined` (all three arguments, verified). `useSortListModel`
  uses a JS `Gtk.Sorter` subclass (`virtual_compare`) and `Gtk.SortListModel` instead. The brief asked
  for `Gtk.CustomSorter`; this is the only working equivalent on this binding, and the test asserts
  the deviation explicitly.
- **`Gtk.FilterListModel:autoexpand` does not exist on GTK 4.24.** `VFilterListModel` accepts the
  prop for API symmetry but ignores it. It was a GTK 3 tree-filter concept.
- **Media interface signals are bridged through notifications.** `Gtk.MediaStream::playing-changed`
  and `::ended` are interface signals and `object.on("playing-changed")` fails with
  `Signal name is invalid` in node-gtk 4.1.1. The components listen to `notify::playing`,
  `notify::ended`, `notify::duration` and `notify::timestamp`; the public Vue events keep GTK names.
- **Missing media files are never played.** `GtkMediaFile` on a nonexistent path logs
  `Gtk-CRITICAL: gtk_gst_media_file_source_setup_cb: assertion 'stream != NULL' failed` when
  `play()` is called. `VMediaFile`/`VVideo` check `Gio.File.queryExists()` first and expose an
  empty state (`available = false`, `error`); the empty state is not an error dialog.
- **GStreamer is optional and never initialized by the library.** With missing plugins the media
  widgets mount, `Gtk.MediaFile` is created for an existing file, but playback may stay paused or
  report an empty duration. Tests initialize `Gst` only in `media.test.mjs` and assert state rather
  than audible playback. GStreamer's own warnings (`scaletempo`, missing `wavparse`) are not GTK
  warnings; this environment has a partial plugin set.
- **`Gtk.MediaControls` has no `playing` property.** `v-model:playing` is derived from and written
  to the attached stream's `playing` property; the internal play/pause buttons do the same. With no
  stream the model is inert.
- **`VPicture` uses `Gdk.Texture.newFromFilename()`.** It needs a local path; `Gio.File` values are
  reduced to `getPath()`. A URI or a file readable only by GIO returns an empty picture. The
  component rejects `paintable` together with `file`/`filename` instead of guessing a precedence.
- **cairo is supported, but only after allocation.** `gi:cairo` loads in node-gtk 4.1.1 and the draw
  callback receives a camelCase `CairoContext` (`setSourceRgb`, `rectangle`, `fill`). GTK calls the
  draw function only once the widget has a size; windows in this X session report `0x0` until the
  main context has run with a delayed iteration, so the draw test presents in a child process. A JS
  exception inside the C draw callback would abort the process, so `VDrawingArea` catches it and
  emits `@error`.
- **GL is desktop-only in the test.** On the current `:0` display `Gtk.GLArea` creates
  `GdkX11GLContextEGL` and emits `render` once the window is allocated, but the suite tests only
  properties, per the wave-4 rule. `@render` receives `null` when no context exists; the handle
  exposes `context`, `api` and `error`.
- **Native boxed values in models.** `v-model:rgba` emits a `Gdk.RGBA` boxed object and
  `v-model:date` a `GLib.DateTime`; a deep `ref()` proxies them. Use `shallowRef`/`useNative()`, as
  with `Gio.ListStore`.
- **Synthesized picker signals.** `Gtk.ColorDialogButton` and `Gtk.FontDialogButton` have no
  `color-set`/`font-set` signals on GTK 4.24. `@color-set`/`@font-set` are emitted from
  `notify::rgba`/`notify::font-desc`, with consecutive duplicates filtered out. Native notification
  caused by a programmatic `setRgba()` cannot be distinguished from a user choice; setting the prop
  itself does not emit because the component compares with the current prop first.
- **Calendar date shapes.** `date` accepts `GLib.DateTime`, `Date`, `YYYY-MM-DD` and
  `{ year, month, day }` with a 1-based month. The exposed handle `month` is 1-based as well; the
  raw `Gtk.Calendar.getMonth()` remains 0-based.
- **`VColumnView` in `selection-mode="none"`.** Wave 4 fixed an older bug: applying a numeric
  `selected` value to a `Gtk.NoSelection` called `setSelected()` on an object that has no such
  method. No-selection views now ignore `selected`; the selection helpers expose `-1` for them.

## Wave 5: small and special widgets

The components live in `packages/vio/src/modules/gtk/small.ts`; the API table, examples and the full
deviation list are in [`small.md`](small.md). The non-obvious limits:

- **`GtkViewport` has no `scroll-to` signal on GTK 4.24.** The wave 5 brief described a GTK 3 API.
  `VViewport` exposes `scrollTo(descendant, scrollInfo)`; connecting `scroll-to` natively fails with
  `Signal name is invalid`, and the test asserts that failure.
- **`GtkRevealer` has no `revealed-changed` signal.** `VRevealer` synthesizes `@revealed-changed`
  from `notify::reveal-child` and keeps the native `@notify::child-revealed` notification for the
  completed transition. `v-model:revealed` writes `reveal-child`.
- **`GtkScrollbar` has no `value` property and no `value-changed` signal.** Both belong to
  `Gtk.Adjustment`. `VScrollbar` creates an adjustment from `min`/`max`/`step` and emits
  `v-model:value`/`@value-changed` from it.
- **`GtkAspectFrame:shrink-child` was removed in 4.24.** `VAspectFrame` accepts the prop and
  approximates it with `hexpand`/`vexpand`. Default-slot children are placed in an internal vertical
  `Gtk.Box`, because the native class is a single-child bin.
- **`GtkTreeExpander:indent-for-expander` was renamed to `indent-for-depth`.** Only the native name
  is written; `indent-for-expander` is accepted as a compatibility alias.
- **`GtkSvgWidget` does not have `file`/`filename`/`paintable` properties on GTK 4.24.** Its real
  surface is `resource`, `state`, `stylesheet`, the read-only `svg` (`Gtk.Svg`) and
  `loadFromBytes()`. `VSvgWidget` reads local files into `GLib.Bytes` and calls `loadFromBytes`;
  `bytes` accepts `GLib.Bytes`, `Uint8Array` or `number[]`. A missing file sets `handle.error` and
  is never passed to GTK. `handle.svg` is aliased as `handle.paintable`, but there is no
  `notify::paintable` property to connect.
- **`GtkWindowControls:decorative` was removed in 4.24.** `VWindowControls` accepts the prop and maps
  `false` to `visible = false`; `side`, `decoration-layout` and `use-native-controls` are native.
- **`VEmojiChooser` is a popover and must be parented.** `popup()` returns `false` and does nothing
  when the chooser has no parent, instead of letting GTK log
  `Gtk-WARNING: Calling gtk_widget_realize() on a widget that isn't inside a toplevel window`.
  `@emoji-picked` forwards the emoji string.
- **`Gtk.PopoverBin` popup is only warning-free through native UI gestures.** Calling the native
  `popup()` on a manually built `VPopoverBin` can log `Gtk-CRITICAL: gtk_widget_is_ancestor`
  depending on GTK's internal state; the component therefore exposes only the child/popover split
  and leaves `.widget.popup()`/`.widget.popdown()` as the imperative escape hatch.
- **`GtkColorChooserWidget` emits `notify::rgba` twice for one `setRgba()`.** `v-model:rgba` is
  therefore driven by `color-activated`, which fires once and carries the `Gdk.RGBA`.
- **`GtkFontChooserWidget` font readback is empty on 4.24.1.** `getFont()` returns `null` and
  `font`/`font-desc` stay empty even after realization. `VFontChooserWidget` applies `font`/`font-desc`
  with setters, but `v-model:font` is driven by `font-activated` (the font name string).
- **Standalone scrollbar theme warning.** On this host, GTK 4.24.1 logs
  `GtkGizmo … (slider) reported min height -2` for a `Gtk.Scrollbar` that is not inside a scrolled
  window, regardless of vio. The `demo:small` window adds a non-scoped CSS rule
  `scrollbar slider { min-width: 8px; min-height: 8px; }`. The wrapper does not install global CSS,
  and the test mounts scrollbars without a window, so the suite stays warning-free.

## Wave 6: construct-only properties and AppChooser

`packages/vio/src/modules/gtk/app-chooser.ts` adds `VAppChooserButton` and `VAppChooserWidget`.
Both rely on the `constructProps` hook described under [Construct-only properties](#construct-only-properties).

- **`Gtk.AppChooserButton` and `Gtk.AppChooserWidget` are now wrapped.** `content-type` is passed to
  the constructor; `VAppChooserButton` maps `heading`, `modal`, `show-dialog-item` and
  `show-default-item`, and exposes `appendSeparator()`, `appendCustomItem()` and `activate()` on the
  handle. `VAppChooserWidget` maps `show-default`, `show-fallback`, `show-other`,
  `show-recommended` and `show-all`. The generic `<gtk-app-chooser-button content-type="…" />` and
  `<gtk-app-chooser-widget content-type="…" />` use the same constructor path.
- **Invalid content types are an empty state.** `VAppChooserButton`/`VAppChooserWidget` validate the
  value with `Gio.contentTypeFromMimeType()` and an RFC 6838 shape check. A missing or invalid value
  (`"nonsense"`, an empty string, a value that normalizes to `null`) creates the native widget without
  `content-type`, exposes `handle.error` and `handle.available === false`, and never calls
  `setProperty("content-type", …)` after construction.
- **`GtkAppChooserWidget::populate-popup` does not exist on GTK 4.24.** The GIR for GTK 4.24 has
  only `application-selected` and `application-activated`; connecting `populate-popup` fails with
  `Signal name is invalid`. The component therefore forwards the two existing signals and documents
  the missing one instead of silently accepting a dead listener. Use `.widget` if a future GTK
  version adds the signal.
- **Real popups are tested in a window.** `VEmojiChooser.popup()` and the `VScaleButton` handle's
  `popup()`/`popdown()` open the native popovers. On this host, GTK 4.24.1 also logs
  `Gdk-WARNING: gdk_frame_timings_submitted() called on submitted frame` after a popover opens; it
  is a GDK frame-clock warning, not a vio error. The test asserts that this is the only remaining
  warning line. The Gizmo slider warning is avoided in the test and demo with the style rule
  `slider { min-width: 16px; min-height: 16px; }`; the library does not install global CSS.

## Imperative escape hatch

`.widget` on a component ref and `vShow` still work against the raw GTK object. For any GTK API that
has no declarative component, register the class with `registerWidget()` and use `defineWidgetComponent()`
or `defineContainerComponent()`; for one-off operations, keep the widget handle in `setup` and call
methods there.
