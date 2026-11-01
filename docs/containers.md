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
| `VOverlay`      | `Gtk.Overlay`   | default slot is the main child, `#overlay` is an overlay layer               |
| `VCenterBox`    | `Gtk.CenterBox` | `#start`, `#center`, `#end` (default fills `#center`)                        |
| `VHeaderBar`    | `Gtk.HeaderBar` | `#start`, `#end`, `#title` (default fills `#start`)                          |
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

`VNotebookPage` accepts a string `label`. For a widget tab label, use the `#tab-label` slot: the
component teleports it into a detached root and calls `Notebook.setTabLabel()`.

`VFixed` reads `x` / `y` from the child element's props. Changing them re-runs placement through
`Fixed.move()`.

`VFlowBox` reorders keyed children with remove + insert. The content widget identity is preserved;
the internal `GtkFlowBoxChild` wrapper is recreated, so wrapper-level CSS does not survive a move.

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
`registerWidget()` is global and throws on duplicates.

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
vp run --filter @zede/vio demo:showcase   # Notebook, Paned, Overlay, ListView + model/factory
```
