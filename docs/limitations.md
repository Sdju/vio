# Declarative layer limitations

This document describes the current state of the declarative layer in `@zede/vio` 0.7.x. It replaces
the earlier version, whose conclusions were too strong: most role containers and native
resources are now expressible with ordinary Vue components and props. The remaining limits are
listed honestly at the end.

Everything reachable imperatively through a component ref or its `.widget` object is still reachable;
GTK and node-gtk are not the limiting factor.

## ChildrenMode and placement hooks

`ChildrenMode` is still a closed union: `none | box | single | list | grid | stack | text`
(`packages/vio/src/modules/gtk/driver.ts`). A user extension still cannot add a new branch to the
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
  create: () => object;
  children?: ChildrenMode;
  controller?: boolean;
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
`setChild is not a function`. Unknown classes keep the legacy `single` inference.

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

- **Adding a `ChildrenMode`** from user code (see above). Use placement hooks or a wrapper.
- **`setProperty(name, null)`** for an object property that is not in the driver's setter table.
  The table covers `model`, `factory`, `file`, `menu-model`, `application`, `settings`; other
  object properties need their own setter in a `watch`.
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

## Imperative escape hatch

`.widget` on a component ref and `vShow` still work against the raw GTK object. For any GTK API that
has no declarative component, register the class with `registerWidget()` and use `defineWidgetComponent()`
or `defineContainerComponent()`; for one-off operations, keep the widget handle in `setup` and call
methods there.
