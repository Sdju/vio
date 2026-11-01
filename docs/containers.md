# Containers, placement hooks and native resources

`@zede/vio` exposes role-based containers as ordinary Vue components. Each component renders one GTK
container element; placement of slot content is described by `WidgetDefinition.insertChild` /
`removeChild` hooks in the GTK driver. No detached roots or driver monkeypatches are needed.

## Components

| Component       | GTK container   | Declarative surface                                                          |
| --------------- | --------------- | ---------------------------------------------------------------------------- |
| `VNotebook`     | `Gtk.Notebook`  | `VNotebookPage` children, tab order follows the Vue order                    |
| `VNotebookPage` | page `Gtk.Box`  | `label` prop or `#tab-label` slot                                            |
| `VPaned`        | `Gtk.Paned`     | `#start`, `#end` (default slot fills `#start`)                               |
| `VOverlay`      | `Gtk.Overlay`   | default slot is the main child, each `#overlay` child is its own layer       |
| `VCenterBox`    | `Gtk.CenterBox` | `#start`, `#center`, `#end` (default fills `#center`)                        |
| `VHeaderBar`    | `Gtk.HeaderBar` | `#start`, `#end`, `#title` (default fills `#start`); slots keep VNode order  |
| `VFlowBox`      | `Gtk.FlowBox`   | default slot, keyed children may be reordered                                |
| `VFixed`        | `Gtk.Fixed`     | default slot, child `x` / `y` props describe the position                    |
| `VListView`     | `Gtk.ListView`  | `model` / `factory` props, no widget children                                |
| `VListModel`    | none (resource) | `items: string[]`, `selected: number`; exposes `store`/`selection`/`factory` |

Every container exposes a component ref with `.element` (the `VioElement`) and `.widget` (the raw GTK
object).

```vue
<VWindow>
  <VHeaderBar role="titlebar">
    <template #title><VLabel>vio</VLabel></template>
  </VHeaderBar>
  <VPaned>
    <template #start>
      <VNotebook>
        <VNotebookPage label="One">…</VNotebookPage>
        <VNotebookPage v-for="item in items" :key="item.id" :label="item.title">…</VNotebookPage>
      </VNotebook>
    </template>
    <template #end>
      <VOverlay>
        <VLabel>main</VLabel>
        <template #overlay><VLabel>overlay</VLabel></template>
      </VOverlay>
    </template>
  </VPaned>
</VWindow>
```

`VHeaderBar role="titlebar"` is a direct child of `VWindow`; the window driver calls
`setTitlebar()` instead of treating it as content, so it does not consume the single content slot.
Vue normally mounts children before props; if `visible` is patched first, the GTK driver holds
presentation until the mount subtree is complete. Either way the titlebar is installed before GTK
realizes the window, regardless of prop/child patch order. On unmount the window is destroyed first
and its titlebar slot is cleared afterwards: GTK warns when `setTitlebar()` runs on a realized
window, so the titlebar cannot be changed while the window is already visible.

`VNotebookPage` accepts a string `label`. For a widget tab label, use the `#tab-label` slot: the
component teleports it into a detached root and calls `Notebook.setTabLabel()`.

`VFixed` reads `x` / `y` from the child element's props. Changing them re-runs placement through
`Fixed.move()`.

`VFlowBox` reorders keyed children by removing the content widget and re-inserting its existing
`GtkFlowBoxChild` wrapper. Both the content widget and the wrapper keep their identity and CSS; a
real removal releases the content from the detached wrapper.

## Placement hooks

`registerWidget()` accepts two optional hooks:

```ts
import { getWidgetDefinition, hasWidget, registerWidget } from "@zede/vio";

if (!hasWidget("my-notebook")) {
  registerWidget("my-notebook", {
    create: () => new Gtk.Notebook(),
    children: "none",
    insertChild({ parentWidget, child, node, role, index }) {
      if (role !== "page") throw new Error("page role required");
      if (parentWidget.pageNum(child) === -1)
        parentWidget.appendPage(child, new Gtk.Label({ label: String(node.props.label ?? "") }));
      parentWidget.reorderChild(child, index);
    },
    removeChild({ parentWidget, child, role }) {
      const page = parentWidget.pageNum(child);
      if (role === "page" && page !== -1) parentWidget.removePage(page);
    },
  });
}
```

Rules the driver guarantees:

- Hooks run after the controller branch and before the `children` mode switch. A definition with a
  hook owns all widget placement, so `children` only describes the mode for roots and diagnostics.
- `role` is `node.props.role` as a string. `before` is `null` for a role child: anchors describe the
  flat VNode list and are meaningless for named slots.
- `index` is the child index among widget-backed, non-controller siblings. Use it for ordered
  containers such as `Notebook` and `FlowBox`.
- A repeated insert is a move. Hooks see the child already parented and must reorder instead of
  appending.
- A removal must be idempotent: Vue does not guarantee removal order, and a full subtree teardown
  may skip individual `remove` calls.
- `insertChild` / `removeChild` must be functions; unknown `children` strings are rejected.

`hasWidget(type)` and `getWidgetDefinition(type)` make wrapper libraries idempotent:
`registerWidget()` is global and throws on duplicates. `getWidgetTypes()` returns the registered type
names, which is useful in diagnostics and error messages.

The renderer calls optional `VioDriver.beginMount()` / `endMount()` around `app.mount()`. The GTK
driver uses them to postpone `visible: true` on windows until the whole subtree exists, which keeps
`setTitlebar()` ahead of realization. A custom driver can ignore both hooks or use them for its own
deferred work.

## Slot order, multiple overlays and removal

The declarative components give every top-level slot item a small role wrapper, so placement hooks
can see one widget per item:

- `VOverlay` accepts any number of `#overlay` children. Each child is added with a separate
  `Gtk.Overlay.addOverlay()` layer; array order is child order, and later VNodes are on top.
- `VHeaderBar` keeps `#start` and `#end` in VNode order. `Gtk.HeaderBar` has no insert-at-index API,
  so a move repacks only that role group with `packStart` / `packEnd`. The widgets are not
  recreated; `#end` is packed in reverse because GTK prepends there.
- `VPaned`, `VCenterBox` and `VNotebookPage` keep their single role wrapper. Removing a slot
  detaches it and releases its content.
- `VFlowBox` preserves the existing `GtkFlowBoxChild` on a move as described above.
- `VFixed` keeps child identity and updates positions from `x` / `y`; its GTK child list is not a
  visual ordering mechanism.

Removal is idempotent for every container. Synthetic wrappers are marked internally and release
their content when the wrapper leaves the container, so a keyed removal does not leave user widgets
parented to a detached box. A full unmount detaches window content and titlebar before destruction.

## Root modes

`createRoot(widget, mode?)` accepts either a `ChildrenMode` or a registered widget type:

```ts
const notebook = createRoot(new Gtk.Notebook()); // inferred as vio-notebook
const paned = createRoot(new Gtk.Paned(), "vio-paned");
const box = createRoot(new Gtk.Box(), "box");
```

Without an explicit mode the driver maps known GTK classes (`Box`, `ListBox`, `Grid`, `Stack`,
`Notebook`, `Paned`, `Overlay`, `CenterBox`, `HeaderBar`, `FlowBox`, `Fixed`) to their registered
definitions. Unknown classes keep the legacy `single` inference.

## Named roots, Teleport and KeepAlive

`Teleport` accepts a registered root name:

```ts
const target = createRoot(new Gtk.Box());
const unregister = registerRoot("sidebar", target);

h(Teleport, { to: "#sidebar" }, () => h(VLabel, null, { default: () => "teleported" }));
```

Only simple `#name` targets are resolved; `getRoot(name)`, `getRootNames()` and
`unregisterRoot(name)` complete the registry. The target widget must exist before the teleport is
mounted, as with any renderer.

`KeepAlive` needs a storage container. vio provides an internal `div` fallback backed by a detached
`Gtk.Box`, so no user registration is required. `hasWidget("div")` remains `false`; an explicit
`registerWidget("div", …)` still overrides the fallback.

## Native values

GObjects are property values, not widgets. Pass them through props:

```ts
const model = useNative<Gtk.SingleSelection>(); // shallowRef, never a reactive proxy
const factory = useNative<Gtk.SignalListItemFactory>();
```

- Never store a native handle in a deep `ref()`: node-gtk rejects Vue proxies. `useNative()` is a
  `shallowRef` wrapper that also marks the initial value raw.
- Removing a `:model`, `:factory`, `:file` or `:menu-model` binding resets it through the dedicated
  setter (`setModel(null)` and friends). `setProperty(name, null)` is rejected by node-gtk and is not
  used by the driver.
- `VListModel` builds `Gio.ListStore` + `Gtk.SingleSelection` + `Gtk.SignalListItemFactory` and
  renders nothing. Place it next to `VListView` and pass `model.selection` / `model.factory`:

```vue
<VListModel ref="model" :items="items" :selected="0" />
<VListView :model="model?.selection" :factory="model?.factory" :vexpand="true" />
```

`VListModel` keeps a JS array beside the store and rebuilds the store from `items` on change, so
add/remove/reorder and unmount are deterministic.

## Helpers

- `useNative(initial?)` — `shallowRef<T | null>` for a GObject handle.
- `useDetachedSlot(create?)` — a `createRoot()`-backed widget outside the parent child list, plus
  `render(slot)` that returns a `Teleport` VNode. Useful for tab labels and other role widgets.
- `defineContainerComponent(name, type, render)` — builds a component whose root is one container
  element, with attrs forwarded and `element`/`widget` exposed.

## Demos

```bash
vp run --filter @zede/vio demo            # counter
vp run --filter @zede/vio demo:showcase   # Notebook, Paned, ordered overlays, reorderable HeaderBar, ListView
```

## Running the tests

`vp run` may pick the Node.js 26 runtime bundled with Vite+, while the local `node-gtk` build uses
the Node.js 24 ABI. Without pinning Node 24, `node-gtk generate-types` fails with
`MODULE_NOT_FOUND: Cannot find module '…/node_gtk.node'`; that is an environment mismatch, not a
regression in a source change. Pin the Node 24 binary on `PATH` for local checks:

```bash
PATH=/home/zede/.vite-plus/js_runtime/node/24.21.0/bin:$PATH vp run check
PATH=/home/zede/.vite-plus/js_runtime/node/24.21.0/bin:$PATH vp run test:gtk
```

Without an interactive display, prefix the GTK command with `dbus-run-session -- xvfb-run -a`. The
path above is an example for this machine; scripts do not hardcode it.
