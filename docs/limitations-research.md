# Declarative layer: limitations re-examined

Status: research note. No package source was changed.

This document checks every claim in [`docs/limitations.md`](limitations.md) against the current
implementation and against live GTK/node-gtk behaviour. It then answers the question that the
previous document leaves open: which of those limits are limits of the **renderer**, and which are
only limits of the **`registerWidget()` surface**, and can be lifted from user code with ordinary
Vue features.

Versions used for the experiments:

| Component   | Version                                                             |
| ----------- | ------------------------------------------------------------------- |
| `@zede/vio` | 0.7.2 (`packages/vio/src`, Node type stripping; `dist` also tested) |
| Vue         | `@vue/runtime-core` 3.5.44                                          |
| node-gtk    | 4.1.1                                                               |
| GTK         | 4.24 (GI typelib, real `DISPLAY=:0`)                                |
| Node.js     | 24.21.0                                                             |

`vp run test` passes (renderer 5/5, compiler 4/4). GTK experiments below were run against
`packages/vio/src` with `node --import node-gtk/register`; they exercised real Gtk/Gio objects, not a
mock driver.

Coverage of the old document:

| `limitations.md` section               | Verdict                                                       | Here             |
| -------------------------------------- | ------------------------------------------------------------- | ---------------- |
| `ChildrenMode`, lines 5-23             | code confirmed; "only `Window`" nuance is wrong               | §1.1-1.3         |
| Containers, lines 25-38                | APIs confirmed; two GTK API details are wrong                 | §1.4             |
| Symptoms, lines 40-45                  | reproduced verbatim (except the `none` nuance)                | §1.3, Appendix A |
| Current workaround, lines 47-49        | confirmed and extended                                        | §4.1             |
| Non-widget GObject, lines 51-81        | property half confirmed; "no place in the tree" is wrong      | §2, §4.4         |
| Lifting the limits, lines 83-97        | proposal 1 accepted in a smaller form; proposal 2 unnecessary | §6               |
| What is not a limitation, lines 99-108 | mostly confirmed, with the `FlowBox`/`Fixed` caveat           | §1.2, §2.5       |

## Short answer

1. The **code references** in `limitations.md` are accurate. Every line number it quotes still
   points at the branch it describes.
2. The **conclusions are too strong**. The "wider Vue" hypothesis is half right: Vue features make
   roles and resources expressible at the **component** layer, but they do not add placement logic
   to the **driver** switch. The two limits are real for `registerWidget()`, but they are not limits
   of what an application can express:
   - Role containers (`Notebook`, `Paned`, `Overlay`, `HeaderBar`, `CenterBox`, `FlowBox`, `Fixed`)
     are expressible today with wrapper components + named slots + `createRoot()`/`Teleport`,
     without touching the driver. This was verified end-to-end, including dynamic page
     insertion/removal/reordering in a `Notebook`.
   - Non-widget GObjects are already accepted as **property values** (`:model`, `:factory`,
     `:menu-model`, `:file`). Creating and owning them declaratively works with components that
     render `null` and use `provide`/`inject`. This was verified with a `Gio.ListStore`, a
     `Gtk.SignalListItemFactory`, a `Gio.Menu`, a `GFile`, and with reactive add/remove.
3. The genuine gaps are narrower than the document says, and most are small:
   - there is no supported way to declare **placement semantics** for role containers in
     `WidgetDefinition` (the driver has a closed switch);
   - `patchProp()` cannot clear a nullable **object** property (`setProperty(name, null)` throws in
     node-gtk);
   - symbol-keyed props never reach the driver (Vue uses `for...in`);
   - `createRoot(existingWidget)` resolves the child mode only for `Box`/`ListBox`/`Grid`; a
     `Notebook`, `Paned` or `FlowBox` root fails;
   - a few adjacent Vue features need one registered dummy type (`KeepAlive`) or are unsupported
     (string `Teleport` targets).
4. Recommended order: ship container wrappers first (no core changes), then add ~60 lines of
   placement hooks to `WidgetDefinition`. A first-class "resource node" in the reconciler is not
   needed.

## 1. Verifying `ChildrenMode` and the insertion dispatch

### 1.1 The closed union is real, but not enforced at runtime

Confirmed:

- `ChildrenMode` is the string union at `packages/vio/src/modules/gtk/driver.ts:8`.
- `WidgetDefinition` has exactly `create`, `children`, `controller`
  (`packages/vio/src/modules/gtk/driver.ts:9-13`).
- `registerWidget()` stores the definition and rejects duplicates
  (`packages/vio/src/modules/gtk/driver.ts:34-37`).
- `childMode()` reads `definition.children ?? "none"` for element nodes and infers the mode from the
  widget class for the root node (`packages/vio/src/modules/gtk/driver.ts:84-91`).
- `insert()` and `remove()` are two fixed if/else chains
  (`packages/vio/src/modules/gtk/driver.ts:163-221` and `222-247`).

Not stated in the document:

- `children` is not validated. Passing a value outside the union from JavaScript is accepted by
  `registerWidget()` and **silently drops every child**: no branch matches in `insert()` and no
  error is raised. Verified: a `Gtk.Box` registered as `children: "roles"` mounted with a child and
  ended with an empty GTK box. This is worse than a compile-time error because a typo produces an
  empty container at runtime.
- `childMode()` does not infer a mode for registered types. `registerWidget("my-box", { create: () =>
new Gtk.Box() })` defaults to `"none"`, even though the class is a `Gtk.Box`.
- For the root node the inference is the opposite: `Box`, `ListBox` and `Grid` are recognised,
  everything else becomes `"single"` (`packages/vio/src/modules/gtk/driver.ts:86-90`). See §6.2.

### 1.2 The `single` branch is not "Window-only"

The document says the branch "casts the parent to `Gtk.Window` and calls `setChild()`"
(`packages/vio/src/modules/gtk/driver.ts:202`). The cast is a TypeScript assertion; at runtime the
method is looked up on the actual GI object. The result therefore depends on the class:

| Class                                                                                              | Runtime `setChild`              | `children: "single"` works                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `Gtk.Window`, `Gtk.Frame`, `Gtk.Button`, `Gtk.ScrolledWindow`, `Gtk.ListBoxRow`, `Gtk.CheckButton` | yes                             | yes                                                       |
| `Gtk.Overlay`                                                                                      | yes (`setChild` + `addOverlay`) | yes for the main child                                    |
| `Gtk.Notebook`, `Gtk.Paned`, `Gtk.CenterBox`                                                       | no                              | no: `TypeError: parent.widget.setChild is not a function` |

Verified by prototype inspection for all classes and by mounting the ones whose behaviour matters
here: `Frame` mounted with one child; `Overlay` mounted with its main child; `Notebook`, `Paned` and
`CenterBox` failed with the exact message above. "What is not a limitation" in the old document is
right about `Frame`, but line 21 should not be read as "only `Gtk.Window` has `setChild`".

### 1.3 `none` throws only for widget-backed nodes

`insert()` is called only when `node.widget` is non-null (`packages/vio/src/modules/renderer/core.ts:101`).
A component that renders `null` becomes a Vue `Comment` vnode, which `core.ts:115` turns into a node
with `widget: null`. Such a node stays in `parent.children`, but:

- it never reaches `driver.insert()` (`core.ts:101`);
- `nextNative()` skips it because `sibling.widget` is falsy (`core.ts:63-70`);
- `concreteChildren()` filters it because it tests `child.widget` (`driver.ts:92-93`).

Verified: a null-rendering component placed **directly inside** an element registered with
`children: "none"` (a `Gtk.ListView`, which has no child API) mounted with no error. The old
document's "throws as soon as a child is declared" (line 44) should say "as soon as a
**widget-backed** child is inserted".
Empty text nodes and comments are transparent; that is also why `Teleport` anchors do not become GTK
children.

Controllers are the only built-in "non-child" role. `isController()` is checked from the child's
definition (`driver.ts:94`), the controller is excluded from the child count (`driver.ts:92-93`) and
from anchors (`driver.ts:153`), and `insert()` calls `addController()` instead of insertion
(`driver.ts:168-174`). This is confirmed by the existing test that mounts `VKeyController` alongside
the single child of `VWindow` (`packages/vio/tests/Fixture.vue:10-12`,
`packages/vio/tests/gtk.test.mjs:27-54`).

### 1.4 Container-by-container check

Every API in the old table was executed against GTK 4.24:

| Container       | Verified API                                                                | Existing mode             | Live result                                                         |
| --------------- | --------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `Gtk.Notebook`  | `appendPage(content, tabLabel)`, `removePage`, `reorderChild`, `pageNum`    | `single` calls `setChild` | fails with `setChild is not a function`                             |
| `Gtk.Paned`     | `setStartChild`, `setEndChild` (both accept `null`)                         | `single` / `box`          | both fail (`setChild` / `insertChildAfter`)                         |
| `Gtk.Overlay`   | `setChild`, `addOverlay`, `removeOverlay`                                   | `single`                  | main child works; a second child is rejected by the one-child check |
| `Gtk.HeaderBar` | `packStart`, `packEnd`, `setTitleWidget`, `remove`                          | `box`                     | fails: `box.insertChildAfter is not a function`                     |
| `Gtk.CenterBox` | `setStartWidget`, `setCenterWidget`, `setEndWidget` (accept `null`)         | `single`                  | fails: `setChild is not a function`                                 |
| `Gtk.FlowBox`   | `append`, `insert`, `remove`; `append` wraps the child in `GtkFlowBoxChild` | `box`                     | fails: `insertChildAfter is not a function`                         |
| `Gtk.Fixed`     | `put`, `move`, `remove`                                                     | `box`                     | fails: `insertChildAfter is not a function`                         |

Two corrections to the old table:

- For `ListView`, `ColumnView` and `GridView` the `model` property is a **`Gtk.SelectionModel`**, not
  a `Gio.ListStore` or `Gtk.TreeListModel`. A store must be wrapped in `Gtk.SingleSelection`,
  `Gtk.MultiSelection` or `Gtk.NoSelection`. Passing a bare `Gio.ListStore` fails with
  `Cannot convert value "[object Object]" to type GtkSelectionModel`. `Gio.ListStore`/`TreeListModel`
  are the underlying `Gio.ListModel`, one level below the view.
- `Gtk.SignalListItemFactory` is a GObject, not a "plain object" (old line 60). Its `setup`/`bind`
  handlers are ordinary GObject signals, so ordinary JS callbacks work; verified below.

`FlowBox.append` does not make the passed widget a direct child: the tree contains a
`Gtk.FlowBoxChild` wrapper. `remove(child)` still accepts the content widget and removes the wrapper.
A keyed reorder therefore cannot use the `Box` strategy; `insert(existingChild, position)` triggers a
GTK critical and leaves `null` in the list. The working sequence is `remove(child)` followed by
`insert(child, position)`, which recreates the wrapper (content identity is preserved, wrapper
identity and wrapper-level CSS are not).

## 2. Verifying the non-widget GObject section

### 2.1 What already works: native values as properties

`patchProp()` does not need a special value type. It reads the default with
`getProperty(property)`, compares it with the new value and calls `setProperty(property, value)`
(`packages/vio/src/modules/gtk/driver.ts:291-295`). If the value is a GObject wrapper, node-gtk hands
the underlying pointer to GTK. Verified in one real mount, all through declarative props:

| Property                      | Value                       | Result                                                      |
| ----------------------------- | --------------------------- | ----------------------------------------------------------- |
| `ListView.model`              | `Gtk.SingleSelection`       | `getModel() === selection`                                  |
| `ListView.factory`            | `Gtk.SignalListItemFactory` | `getFactory() === factory`; item `setup`/`bind` ran         |
| `ColumnView.model`            | `Gtk.SingleSelection`       | `getModel() === selection`; `appendColumn` added the column |
| `Picture.file` / `Video.file` | `Gio.File`                  | `getFile()` returns the file                                |
| `PopoverMenu.menu-model`      | `Gio.Menu`                  | `getMenuModel() === menu`                                   |

`Gtk.ColumnViewColumn` and `Gtk.ColumnView.appendColumn()` also work from JS. `appendColumn` is a
method, not a property, so it needs one imperative call in `onMounted` (or a wrapper); everything
else above is a plain prop.

### 2.2 Two real traps with native values

These are not findable from the old document and matter more than the renderer API:

1. **Do not put a GObject in a deep `ref()`.** `ref(selection)` wraps the object in a Vue `Proxy`;
   node-gtk then rejects it with `Cannot convert value "[object Object]" to type GtkSelectionModel`.
   `shallowRef(selection)` works for mount and for replacing the model. `ref(markRaw(selection))`
   works only while every assigned value is also raw; assigning a fresh (unmarked) object fails.
   Recommended rule: native handles live in `shallowRef` (or are `markRaw`ed) and are never made
   deeply reactive.
2. **`setProperty(name, null)` is not a clear operation.** node-gtk 4.1.1 accepts `null` in the
   dedicated setters (`setModel(null)`, `setFactory(null)`, `setFile(null)`,
   `setMenuModel(null)`) but rejects it in the generic property path:
   `Cannot convert value "null" to type GtkSelectionModel` (same for `GtkListItemFactory`, `GFile`,
   `GMenuModel`). Because `patchProp()` resets a removed binding to the recorded default (usually
   `null`), removing `:model="..."` or toggling it through `null` throws. Workaround: keep a
   non-null value, or unbind with the dedicated setter in `watch`/`onUnmounted`.
   A small driver fix is possible; see §6.3.

### 2.3 A resource does have a place in the tree

The old document says "A Vue template has no syntax for 'a widget argument rather than a child'"
(line 66) and "there is no place in the template tree to create it" (line 68). Both are false at the
component layer:

- `:model="selection"` / `:factory="factory"` are normal template props; nothing forces the value to
  be a child. The compiler emits them as element props.
- A component may render `null` and own the object in `setup`. It is invisible to GTK (§1.3) and can
  register itself with a parent through `provide`/`inject`, a parent `ref`, or `onVnodeMounted`.
- Ownership is Vue ownership: create in `setup`, update in `watch`, dispose in `onUnmounted`.

Verified pattern (abridged, real code):

```ts
const VListModel = defineComponent({
  setup(_props, { slots }) {
    const store = Gio.ListStore.new(getGType(Gtk.StringObject));
    const selection = new Gtk.SingleSelection({ model: store });
    const factory = new Gtk.SignalListItemFactory(); // setup/bind attach widgets to GtkListItem
    const owned = [];
    const ctx = {
      store,
      add: (o) => {
        owned.push(o);
        store.append(o);
      },
      remove: (o) => {
        const i = owned.indexOf(o);
        if (i !== -1) {
          owned.splice(i, 1);
          store.remove(i);
        }
      },
    };
    provide("list-model", ctx);
    expose({ store, selection, factory });
    // "gtk-list-view" is the registered type with children: "none"
    return () =>
      h(Fragment, null, [h("gtk-list-view", { model: selection, factory }), slots.default?.()]);
  },
});

const VStringItem = defineComponent({
  props: { value: String },
  setup(props) {
    const obj = Gtk.StringObject.new(props.value);
    const ctx = inject("list-model");
    onMounted(() => ctx.add(obj));
    onUnmounted(() => ctx.remove(obj));
    return () => null;
  },
});
```

Two caveats from the experiment:

- `Gio.ListStore.find(item)` returns a GI out-parameter tuple, not an index: the observed value was
  `[true, 0]` (found, position). Treating it as a number silently removed the wrong item. Keep a JS
  array (or a `Map`) next to the store and remove by index. Without that, unmounting an item left it
  in the store.
- Keyed reordering of item components does not reorder the store, because Vue moves the components
  without remounting them. A list wrapper must sync order on update (e.g. `watch` on the key list and
  `store.splice`/re-append), or the store must be rebuilt from props.

With those caveats, a declarative model graph works: mounting `["one","two","three"]`, changing it to
`["two","four"]` produced exactly `["two","four"]` in the `Gio.ListStore`, and unmounting the list
left `0` items.

### 2.4 Process-level objects

`Gtk.Application`, `Gio.SimpleAction`/`Gio.SimpleActionGroup` and `Gio.Settings` do not belong to the
widget tree, and that is not a renderer limit:

- `new Gtk.Application({ applicationId })` + `Gio.SimpleAction` + `app.addAction()` works; a
  `Gtk.Button` accepts `action-name="app.open"` as a normal property.
- `Gio.Settings.new("org.gnome.desktop.interface")` works (schema must be installed).
- Per-widget action groups work through `widget.insertActionGroup("app", group)`.

Keep these in `setup`/provider components or in the entry module next to `Gtk.init()`; they do not
need a VNode.

### 2.5 "What is not a limitation" (old lines 99-108)

The old section is largely correct; only its last two bullets need qualification:

- "89 widgets without a built-in component" is a surface count, not a mechanism count. Correct.
- Leaf widgets (`SearchEntry`, `ProgressBar`, `LevelBar`) need a component and a property surface;
  `defineWidgetComponent` covers the common case. One adjacent gap: the string-enum table
  (`packages/vio/src/modules/gtk/driver.ts:104-150`) is closed too, so enums outside that table must
  be passed as GI integer values. That is a component/docs issue, not a renderer issue.
- Single-child containers work **only** when the class implements `setChild` (§1.2). `Frame`,
  `Button`, `ScrolledWindow`, `ListBoxRow`, `CheckButton` and `Overlay` do; `Notebook`, `Paned` and
  `CenterBox` do not.
- `FlowBox`/`Fixed` can be **registered** as widgets today, but their declarative children still
  need a wrapper or the placement hooks in §6.1. The old statement is right about the need, wrong
  about the only possible implementation (a wrapper needs no core change; verified).
- The `.widget` escape hatch is real: component refs expose `widget` and `element`
  (`packages/vio/src/modules/gtk/components.ts:9-17`), and `vShow` itself is written against
  `node.widget` (`packages/vio/src/app/index.ts:93-96`).

## 3. What the renderer really does with a Vue tree

This is the part the old document under-describes. The numbers refer to
`packages/vio/src/modules/renderer/core.ts`.

| Mechanism        | Implementation                                                                                                                               | Consequence for extensions                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Element creation | `createElement(type)` strips `gtk-` and calls `driver.create(type)`; namespace and `vnodeProps` are ignored (`107-113`)                      | A driver cannot see role/props at creation; props arrive later via `patchProp`                                                         |
| Node model       | `kind`, `type`, `widget`, `parent`, `children`, `props`, `text`, `events` (`8-18`, `45-56`)                                                  | `props` is the only per-node extension bag                                                                                             |
| Insertion        | `insert()` splices the node into `parent.children`, then calls `driver.insert(node, parent, nextNative(node))` (`92-102`)                    | Anchors are computed over sibling **widgets**, not VNodes                                                                              |
| Anchor           | `nextNative()` returns the first later sibling with a widget and `isAnchor()` true (`63-70`)                                                 | Comments, empty texts, controllers are skipped; a "resource with a widget" would incorrectly become an anchor                          |
| Removal          | `remove()` → `detach()` → `driver.remove` → `dispose()` recursion (`71-91`)                                                                  | On a full subtree unmount, descendants are **not** individually removed, only disposed (verified by logging `driver.remove`/`dispose`) |
| Keyed move       | Vue 3.5 has no host `move` option; a move is a remove+insert, or a re-insert into the same parent (`RendererOptions` in `@vue/runtime-core`) | Re-inserted nodes may already be parented in GTK; container hooks must handle "move", not only "append"                                |
| Prop patch       | `node.props[key] = value` first (`139`), events handled separately (`140-176`), then `driver.patchProp` (`177-184`)                          | **String** props (including unknown ones) are visible to `driver.insert()`; symbol props are not                                       |
| Reserved props   | Vue does not call `hostPatchProp` for `key`, `ref`, `onVnodeBeforeMount`, `onVnodeMounted`, etc.                                             | `onVnodeMounted` is safe on GTK elements and receives the `VioNode` in `vnode.el`                                                      |
| Directives       | Vue invokes `created` after element creation and **before** props/insert; `mounted`/`updated`/`unmounted` run on the `VioNode`               | A `created` hook can add markers to `el.props` before `driver.insert()`                                                                |
| Scope id         | `setScopeId` adds a CSS class (`driver.ts:318-320`)                                                                                          | No DOM attributes; scoped styles are classes                                                                                           |
| Text             | `createText("")` yields `widget: null`; `setText` removes an empty node, creates a label for non-empty text (`103-131`)                      | Empty text is a transparent anchor; non-empty text is a real `Gtk.Label`                                                               |

Consequences that matter for the two limits:

1. A component that renders nothing contributes a comment node with no widget, which is transparent
   to every driver branch. That is the foundation of the "resource component" pattern.
2. A node's `props` are populated **before** `driver.insert()` runs. A string prop is therefore
   available to an insertion hook without any reconciler change. This was verified by wrapping
   `gtkDriver.insert` and reading `node.props.role` at insertion time.
3. Symbol keys are skipped by Vue's `for (const key in props)` and never reach `patchProp`, so they
   are not in `node.props`. They are still visible in the VNode (render functions, named slots) and
   can be copied into `el.props` by a directive's `created` hook. Symbols are therefore usable as a
   render-function-level marker, not as a native property.
4. `driver.patchProp` is called without `parentComponent` (`core.ts:180` passes four arguments even
   though Vue supplies six). Resource ownership cannot be implemented inside the driver today; it
   works fine in components.
5. There is **no filtering by role, type or arbitrary flags**. The only special child flag is
   `controller` (`driver.ts:92-94`); everything else is considered a widget child as soon as it has
   a `widget`. Any new role scheme therefore has to add a flag or a definition hook; markers alone
   change nothing unless some code reads them.

## 4. Mechanisms that work today (verified)

### 4.1 Role containers as wrapper components

A wrapper renders the container element with `children: "none"` (no VNode children) and one
**detached root per role**:

```ts
const root = createRoot(new Gtk.Box()); // VioElement whose widget is a GtkBox
onMounted(() => el.value.widget.appendPage(root.widget, tabLabel));
return () =>
  h(Fragment, null, [
    h("gtk-notebook", { ref: el }), // registered as children: "none"
    h(Teleport, { to: root }, [slots.default?.()]),
  ]);
```

Why this works with the real driver:

- `createRoot(widget)` returns a normal `VioElement` (`core.ts:57-58`; exported from `app/index.ts`).
- `Teleport` needs only `insert`/`parentNode`/`createText`/`createComment`; all exist. Its target must
  be a `VioElement`, not a raw `Gtk.Widget`, because `insert()` needs `children`/`parent`.
- The target root's widget is a `Gtk.Box`, so `childMode()` resolves to `"box"` and the teleported
  content is inserted with the normal box branch.
- The container element has zero VNode children, so the `single`/`none` checks never see the pages.
  Role placement is a method call in `onMounted`, outside the driver.

Verified results:

| Wrapper                                  | Result                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `VNotebook` (two named page slots)       | `getNPages() === 2`, tab labels `page1`/`page2`, content labels correct                         |
| `VNotebook` dynamic (`v-for` pages)      | add/remove/reorder produced `[["C","three"],["A","one!"]]` then `[["A","one!"]]` with no errors |
| `VPaned` (`#start`/`#end`)               | `getStartChild()` / `getEndChild()` contain the expected labels                                 |
| `VCenterBox` (`#start`/`#center`/`#end`) | all three slots populated                                                                       |
| `VOverlay` (default + one overlay)       | main child attached; overlay attached via `addOverlay`                                          |
| `VHeaderBar` (`#start`/`#end`/`#title`)  | `packStart`/`packEnd`/`setTitleWidget` accepted the role groups; title label rendered           |
| `VFlowBox` (`items` array)               | two item roots appended; labels `fa`/`fb`                                                       |
| `VFixed` (`items` with `x`/`y`)          | item root `put` at `10,20`; label `fx`                                                          |
| Reactive content update inside a page    | label text changed from `one` to `two`, page count stayed `1`                                   |

This is **user-space code**: no driver edit, no reconciler edit. It needs a new module with wrappers
and tests, not a renderer change.

Design notes:

- Each role needs at least a `Gtk.Box` layer. That affects CSS selectors and accessibility trees;
  it is the main cost of the pattern.
- The container type must be registered once (`registerWidget("notebook", { create: () => new
Gtk.Notebook(), children: "none" })`). `registerWidget` is global and not idempotent (duplicate
  throws), so a helper needs its own guard; there is no `hasWidget()` export today.
- For dynamic pages, create the detached roots in a `Map` keyed by page key (in render or in
  `onBeforeUpdate`), remove pages in `onUpdated`, and reorder with `Notebook.reorderChild`. A 40-line
  wrapper handled add/remove/reorder in the experiment.
- On a full application unmount, Vue does not call `driver.remove` for descendants (§3). Detached
  roots therefore stay referenced by the wrapper closure; clear their `widget` fields or let the
  container destruction collect them.
- `Gtk.HeaderBar` as a window titlebar needs access to the window
  (`window.setTitlebar(headerbar)`, verified). Prefer a `#titlebar` slot on a window wrapper; pulling
  the header bar out of the content box from user code would desynchronise Vue's child list.

### 4.2 Named slots as the role source

Named slots are ordinary Vue slots; the wrapper's `setup` sees them by name and decides what to
teleport where. Verified: a component receiving `default` and `tab-label` slots saw
`["default","tab-label"]` and could render each independently. `defineWidgetComponent()` forwards
only `slots.default` (`packages/vio/src/modules/gtk/components.ts:17`), so a role wrapper must be a
hand-written component; that is a component-surface gap, not a driver gap.

### 4.3 VNode markers

Three marker levels, with different reach:

| Marker                                                              | Reaches                                                                                                      | Verified                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| String prop on a GTK element (`role="tab-label"`, `vio-role="..."`) | `node.props` at `insert()`; `setProperty` is a silent no-op because GTK has no such property                 | yes: `node.props.role` was `"tab-label"` inside `driver.insert`; unknown props did not throw |
| Symbol key in `h(type, { [sym]: "tab" })`                           | VNode props only; skipped by Vue's `for...in`; not in `node.props`                                           | yes: `Object.getOwnPropertySymbols(node.props)` was empty                                    |
| Directive `v-role="tab-label"`                                      | `created(el, binding, vnode)` runs before `driver.insert()`; writing `el.props.role` is visible to insertion | yes: directive marker was present at insert                                                  |

Ordering was confirmed with a wrapped driver: `created` → `patchProp(role)` → `insert`. If both a
directive and a string prop set the same key, the string prop wins because `patchProp` writes
`node.props[key]` after `created`.

Consequence: a role-aware driver can be built today by reading `node.props.role` (strings) or by
using a directive to copy symbols; no Vue-internal API is required. What is missing is a place in
`WidgetDefinition` that **acts** on the role.

### 4.4 Non-child nodes as resource components

Verified patterns:

- `provide`/`inject` from a container wrapper to a resource component that renders `null`;
  `onMounted` sets the model, `onUnmounted` clears it with the dedicated setter. Capture the GTK
  widget in a local variable at bind time: during a full app unmount the element ref is cleared
  before `onUnmounted` runs, so `ref.value?.widget` is already `null`.
- `onVnodeMounted` on the container element (`vnode.el` is the `VioNode`; `vnode.el.widget` is the
  GTK object). It runs after insertion; use it when a component ref is inconvenient.
- `expose({ store, selection, factory })` on a provider component, consumed through a component ref
  (same pattern as `VWidgetHandle` in `components.ts:9-17`).
- `defineExpose` in SFCs is already covered by the existing fixture test
  (`packages/vio/tests/gtk.test.mjs:27-54`).

What does **not** work is an element node backed by a non-widget: `<gtk-list-store>` would go through
`createElement` → `driver.create` → `insert` and be treated as a `Gtk.Widget`. There is no node flag
for "resource" and `remove()` calls `child.getParent()` (`driver.ts:240-241`). Components avoid this
entirely.

### 4.5 Driver-level extension without core changes

Two supported-ish options exist:

1. **Own renderer.** `createVioRenderer(driver)` and `createRoot()` are public (`app/index.ts:45-51`,
   README line 111), and the renderer tests already use a fake driver
   (`packages/vio/tests/renderer.test.mjs:31-71`). A wrapper driver can delegate everything to
   `gtkDriver` and override `create`/`insert`/`remove` for role containers. Verified with a custom
   `notebook2` type and `role` props: one page with tab label `Tab` and content `content`.
2. **Monkeypatch the singleton.** `gtkDriver` is a plain exported object and the app renderer holds
   that same object (`app/index.ts:59`), so assigning `gtkDriver.insert` is observed by the running
   app. Verified for logging and for role dispatch.

Both are workable but not API contracts: option 1 duplicates the app factory and loses the module
singleton's conveniences; option 2 is global, untyped and fragile across package copies. They are
useful for prototypes, not for a published container library.

### 4.6 Vue runtime features

| Feature                         | Result                                                                                                                                          | Evidence                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Fragment` / keyed `v-for`      | works, physical order preserved                                                                                                                 | `renderer.test.mjs:73-153`, `gtk.test.mjs:56-103`                                                                                            |
| Named slots                     | preserved by name                                                                                                                               | §4.2                                                                                                                                         |
| `Teleport` to a `VioElement`    | works; disabled/unmount removes teleported widgets                                                                                              | §4.1; target box went from 1 child to 0 on unmount                                                                                           |
| `Teleport` to a string selector | unsupported: no `querySelector`; dev warning crashes while formatting `null` target                                                             | verified: `resolveTarget` returns `null`, Vue's warn helper throws `Cannot read properties of null (reading 'toString')`                     |
| `Suspense` + async `setup`      | works; fallback is replaced by the async subtree                                                                                                | verified with a 5 ms async component                                                                                                         |
| `KeepAlive`                     | works **after** `registerWidget("div", { create: () => new Gtk.Box(), children: "box" })`; widget identity preserved across deactivate/activate | Vue creates `createElement("div")` as storage (`runtime-core` 3.5.44, `KeepAlive` setup); without registration `driver.create("div")` throws |
| Functional components           | work; `() => null` is transparent, passthrough via `ctx.slots` preserves order                                                                  | verified                                                                                                                                     |
| Custom directives               | `created`/`beforeMount`/`mounted`/`updated`/`unmounted` receive the `VioElement`; a directive can mutate `el.props` before insert               | verified                                                                                                                                     |
| VNode hooks                     | `onVnodeMounted`/`onVnodeBeforeUnmount` are reserved by Vue and never become GTK properties; `vnode.el` is the `VioNode`                        | verified                                                                                                                                     |
| `defineExpose` / component refs | works, including a `widget` getter                                                                                                              | `components.ts:9-17`, `gtk.test.mjs:27-54`                                                                                                   |

## 5. node-gtk capabilities (evidence)

Everything below was executed against the installed node-gtk 4.1.1 and GTK 4.24. In-repo evidence
that JS callbacks already cross the native boundary: every event goes through
`native(node).on(signal, callback)` (`packages/vio/src/modules/gtk/driver.ts:312-317`), the CSS
provider receives `GtkCssSection`/`GLib.Error` in a JS handler (`driver.ts:46-48`), and the renderer
tests pin callback replacement, `once`, disconnection and error routing
(`packages/vio/tests/renderer.test.mjs:155-247`).

| Capability                                                                                | Result                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Notebook.appendPage(content, tab)`, `removePage`, `reorderChild`                         | works; page and tab are independent widgets                                                                                                              |
| `Paned.setStartChild/setEndChild`, including `null`                                       | works                                                                                                                                                    |
| `Overlay.setChild/addOverlay/removeOverlay`                                               | works; internal child order is main, overlay, overlay                                                                                                    |
| `HeaderBar.packStart/packEnd/setTitleWidget/remove`                                       | works                                                                                                                                                    |
| `CenterBox.setStartWidget/setCenterWidget/setEndWidget`, including `null`                 | works                                                                                                                                                    |
| `FlowBox.append`                                                                          | works, but wraps in `GtkFlowBoxChild`; `insert(existing)` is unsafe; `remove(child)` works                                                               |
| `Fixed.put/move/remove`                                                                   | works                                                                                                                                                    |
| `Gio.ListStore.new(getGType(Gtk.StringObject))` + `append`/`getItem`                      | works; use `Gtk.StringObject.new("alpha")` (the `new Gtk.StringObject({ string })` form emits a GObject critical)                                        |
| `Gtk.SingleSelection` wrapping a `Gio.ListStore`; `ListView/ColumnView/GridView.setModel` | works with a selection model; a bare store is rejected                                                                                                   |
| `Gtk.SignalListItemFactory` `.on("setup"/"bind")`                                         | works; handlers receive `Gtk.ListItem`; `setChild()`/`getItem()` work; `view.allocate(200,200,-1,null)` triggered both signals in a non-presented window |
| `Gtk.TreeListModel.new(store, false, false, createFunc)`                                  | works; the JS `createFunc` was called on `row.setExpanded(true)` (proves JS→GClosure for callback parameters)                                            |
| `Gtk.ColumnViewColumn({ title, factory })` + `ColumnView.appendColumn`                    | works                                                                                                                                                    |
| `Gio.Menu` + `PopoverMenu.setMenuModel` / `menu-model` prop                               | works                                                                                                                                                    |
| `Gio.File` + `Picture.setFile` / `file` prop; `Video.file`                                | works; `Gtk.MediaFile.newForFilename` constructs (GStreamer warnings on this machine)                                                                    |
| `Gtk.Application` + `Gio.SimpleAction` + `addAction`; `Gio.Settings.new`                  | works                                                                                                                                                    |
| `Widget.insertActionGroup`; `Button.action-name`                                          | works                                                                                                                                                    |
| `registerClass(GObject subclass)`                                                         | works (`Probe` GType, JS methods); `registerClass(Gtk.Widget subclass)` with `virtual_measure` works and can be appended to a box                        |
| GObject property installation on a JS subclass                                            | **not supported** by node-gtk 4.1.1 (`register-class.js` wires vfuncs only; no `install_property`)                                                       |
| `GObject.setProperty` static                                                              | does not exist; the instance method is `obj.setProperty(name, value)`                                                                                    |
| unknown property: `getProperty("role")` / `setProperty("role", ...)`                      | returns `undefined` / silent no-op; no exception                                                                                                         |
| nullable object property: `setProperty("model", null)`                                    | throws; dedicated `setModel(null)` works                                                                                                                 |

This confirms the old document's premise that GTK itself is not the limit. It also narrows the real
node-gtk limits to object-property clearing and custom-property installation.

## 6. What still needs the core

Three changes have a clear payoff; the optional items in §6.4 are listed separately. Estimates are
for implementation + tests in this repository.

### 6.1 Placement hooks on `WidgetDefinition` (S, ~60-100 lines)

```ts
export interface Placement {
  parent: VioElement; // has type/props/children
  parentWidget: Gtk.Widget;
  child: Gtk.Widget;
  role: string | null; // from node.props.role, or a definition default
  before: Gtk.Widget | null; // may be null or meaningless for role slots
}
export interface WidgetDefinition {
  create: () => object;
  children?: ChildrenMode;
  controller?: boolean;
  insertChild?: (p: Placement) => void; // bypasses the closed switch
  removeChild?: (p: Placement) => void;
}
```

Dispatch in `insert()` after the controller branch and before `childMode()`; dispatch in `remove()`
after the controller branch. Points to touch: `driver.ts:9-13`, `163-221`, `222-247`.
Requirements the tests must pin down:

- re-insert of a child that is already parented (move, not append);
- role slots that are not "children" in the VNode sense (tab label, overlay, title);
- idempotent removal when Vue's order differs (log showed removal order is not guaranteed);
- anchors are ignored for role slots (`before` can be the next sibling by GTK, which may belong to a
  different role);
- full-subtree teardown calls no `remove` for descendants (§3); cleanup belongs in `dispose` or in
  component hooks.

This removes the need for the monkeypatch/custom-renderer tricks for the listed containers. It does
not make `Notebook` a single-child container; it replaces the mode check with a role-aware path.

### 6.2 Root child mode (S)

`childMode()` for `kind === "root"` uses `instanceof` (`driver.ts:86-90`). Add a mode parameter to
`createRoot(widget, mode?)` or a `WeakMap<object, ChildrenMode>` populated by `registerWidget`.
Without it, `createRoot(new Gtk.Notebook())`, `createRoot(new Gtk.FlowBox())` and
`createRoot(new Gtk.Paned())` throw `setChild is not a function` (verified), despite README line 111
promising "an existing GTK container". `createRoot(new Gtk.Box())` and `createRoot(new
Gtk.Overlay())` work.

### 6.3 Nil handling for object properties (S)

`patchProp()` cannot clear `model`, `factory`, `file`, `menu-model` and similar. Add a small table
`property -> setter` (or derive `set${Camel}` and verify the method exists), and when `value == null`
call the setter; fall back to `setProperty` for scalars. Points: `driver.ts:291-295`. Without this,
removing a binding or assigning `null` throws (verified errors in §2.2). Workarounds in user code:
never null, or use a `watch` with the setter.

### 6.4 Optional: symbol markers, validation, Teleport selector, KeepAlive (each S)

- Copy symbol keys from the `vnodeProps` argument of `createElement` into `node.props`
  (`core.ts:107-113`) or explicitly do not support symbols and document directives as the way.
- Validate `children` in `registerWidget` and throw on an unknown mode; today an unknown string
  silently drops children (§1.1).
- Export `hasWidget(type)` / `getWidgetDefinition(type)` so wrapper libraries can register
  idempotently.
- Implement `querySelector(selector)` over a registry of named roots, or document that `Teleport`
  targets must be `VioElement`s. String targets crash in development today.
- Provide a storage container for `KeepAlive` instead of requiring a user-registered `"div"`.

### 6.5 What is not worth adding

- A generic **resource node** in the reconciler. Components already provide creation, ownership,
  updates and cleanup; a node would need new rules for anchors, `concreteChildren`, `dispose` and
  ownership, for no expressive gain. The old proposal's M/L estimate is realistic only because the
  feature is unnecessary.
- Multiple natives per VNode (page + tab label in one node). A wrapper with one root per role is
  simpler and keeps the VNode/native invariant intact.
- `GtkBuildable` integration. It is a `GtkBuilder` construction protocol; vio does not use
  `GtkBuilder`, and implementing `Buildable` would not help the Vue tree.
- Duck-typing `setChild` for `Notebook`/`Paned`. There is no such method to duck-type; the correct
  APIs are different.

## 7. Constraint matrix

| Limit                                                   | Expressible today                                       | Verified workaround                                                                     | Core change needed                                | Effort |
| ------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| `Notebook` pages + tab labels                           | yes                                                     | wrapper + detached roots + `appendPage`; dynamic pages with `reorderChild`/`removePage` | no (hooks optional)                               | S-M    |
| `Paned` start/end                                       | yes                                                     | wrapper + two named slots + `setStartChild`/`setEndChild`                               | no                                                | S      |
| `Overlay` main + overlays                               | main child: yes via `single`; overlays: yes via wrapper | wrapper + `setChild`/`addOverlay`                                                       | no                                                | S      |
| `HeaderBar` start/end/title                             | yes                                                     | wrapper + `packStart`/`packEnd`/`setTitleWidget`; titlebar needs a window slot          | no                                                | S-M    |
| `CenterBox` three slots                                 | yes                                                     | wrapper + three named slots                                                             | no                                                | S      |
| `FlowBox` / `Fixed` children                            | yes                                                     | wrapper per item; `append`/`put`; keyed `FlowBox` reorder is remove+insert              | no (hook for first-class)                         | M      |
| Role slots in general                                   | yes                                                     | named slots; string markers reach `node.props`; directives can add symbols              | hooks if roles must go through `registerWidget`   | S      |
| `registerWidget` new mode                               | no                                                      | custom renderer/driver or monkeypatch; wrappers avoid the need                          | yes for a supported API                           | S      |
| Models (`ListStore`, `TreeListModel`, `SelectionModel`) | yes                                                     | `:model` prop with `shallowRef`; selection wrapper required                             | no (clearing is separate)                         | S      |
| Item factories                                          | yes                                                     | `:factory` prop; `setup`/`bind` JS callbacks                                            | no                                                | S      |
| `ColumnViewColumn` / columns                            | yes                                                     | resource component + `appendColumn` in `onMounted`                                      | no                                                | S      |
| `GFile` / media                                         | yes                                                     | `:file` prop or `setFile`                                                               | no                                                | S      |
| `Gio.MenuModel`                                         | yes                                                     | `:menu-model` prop; `Gio.Menu` built in setup/component                                 | no                                                | S      |
| `Gtk.Application`, actions, `GSettings`                 | yes (outside tree)                                      | entry/setup/provider; `action-name`, `insertActionGroup`                                | no                                                | S      |
| Resource lifetime/updates                               | yes                                                     | `setup` + `watch` + `onUnmounted`; `expose`; `onVnodeMounted`                           | no                                                | S      |
| Native values under deep `ref()`                        | no (proxy trap)                                         | `shallowRef`/`markRaw`                                                                  | no (docs/helper)                                  | S      |
| Clearing nullable object props                          | no                                                      | dedicated setter in `watch`; never pass `null`                                          | yes (small)                                       | S      |
| `createRoot` on arbitrary container                     | no                                                      | wrap in a `Gtk.Box` root and append it                                                  | yes (small)                                       | S      |
| Symbol props in driver                                  | no                                                      | directive `created` copies to `el.props`                                                | optional                                          | S      |
| Unknown `children` value                                | no (silent)                                             | none; typo drops children                                                               | validation                                        | S      |
| `KeepAlive`                                             | yes after dummy registration                            | `registerWidget("div", { create: () => new Gtk.Box(), children: "box" })`               | optional storage option                           | S      |
| `Teleport` string targets                               | no                                                      | pass a `VioElement`                                                                     | optional `querySelector`                          | S      |
| Custom GObject subclass                                 | yes                                                     | `registerClass`; vfuncs + JS state                                                      | node-gtk lacks property install; not a vio change | S/M    |
| Multiple natives per VNode                              | no                                                      | wrapper with one root per role                                                          | not worth it                                      | M      |

## 8. Priority plan

### Iteration 1 — no core changes (1-2 days)

1. Add `packages/vio/src/modules/gtk/containers.ts`:
   - `useDetachedSlot()` / `defineContainerComponent()` helper around `createRoot` + `Teleport`;
   - `VNotebook`/`VNotebookPage` (static and keyed pages), `VPaned`, `VOverlay`, `VCenterBox`,
     `VHeaderBar`, `VFlowBox`, `VFixed`;
   - `useNative()` (or a documented `shallowRef` rule) for GObject handles.
2. Export the new components from `modules/gtk/index.ts` and `app/index.ts`.
3. Add `packages/vio/tests/containers.test.mjs` with real GTK:
   - page add/remove/reorder and tab labels; `Paned` both slots; `Overlay` main+overlay;
     `CenterBox` three slots; `HeaderBar` plus a window titlebar wrapper; `FlowBox`/`Fixed`;
   - unmount cleanup (no stale widgets);
   - resource tests: `:model`/`:factory`/`:menu-model`/`:file`, `shallowRef` updates,
     dedicated-setter unbinding, model add/remove/unmount.
4. Document the native-value rules and correct the two GTK API mistakes from `limitations.md`
   (do not edit that file as part of this research; apply in a docs follow-up).

Exit criterion: every container in §1.4 has a declarative component and a test that passes under
`vp run test:gtk`.

### Iteration 2 — minimal core (2-3 days)

1. `WidgetDefinition.insertChild` / `removeChild` + role from `node.props.role` (§6.1), with
   move/idempotent-remove tests for `Notebook`, `Paned`, `Overlay`, `HeaderBar`, `CenterBox`,
   `FlowBox`, `Fixed`.
2. Root mode override (§6.2).
3. Null-object unset table (§6.3).
4. Optional, only if still needed: symbol copy, `children` validation, `hasWidget`, `querySelector`,
   `KeepAlive` storage.

Exit criterion: `registerWidget("notebook", { ..., insertChild, removeChild })` produces a working
notebook without a wrapper, and existing keyed `VBox`/`VListBox` tests keep their identity guarantees.

## 9. What is genuinely impossible or not worth doing

- **Adding a `ChildrenMode` from user code** so that `registerWidget()` gains a new branch. The
  dispatch is a private switch; wrappers or a driver change are the only options. An unknown string
  is silently ignored, so do not rely on it.
- **A `<gtk-...>` element backed by a non-widget** (model, factory, menu). Element nodes always go
  through `create`/`insert`/`remove` and are assumed to be `Gtk.Widget`s. Use a null-rendering
  component.
- **Symbol-keyed props as native properties.** Vue intentionally skips them in `for...in`; use a
  directive or string markers.
- **`setProperty(name, null)` for nullable object properties.** node-gtk 4.1.1 rejects it; use the
  dedicated setter.
- **Custom GObject _properties_ on a `registerClass` subclass.** node-gtk exposes vfunc overrides, not
  property installation. Use JS accessors/signals, or a GObject wrapper.
- **String `Teleport` targets.** No `querySelector` in the renderer; pass a `VioElement`.
- **`KeepAlive` without a storage type.** It calls `createElement("div")`; register a widget for
  `"div"` (verified) or avoid `KeepAlive`.
- **Multiple GTK natives produced by one VNode** (page content and tab label from one node). A role
  wrapper with one detached root per role is the supported shape.
- **`GtkBuildable`** as an extension mechanism. It belongs to `GtkBuilder`, not to this renderer.
- **Forcing `FlowBox`/`Fixed` into the `box` mode.** Their APIs differ (`append`/`put`, wrapper
  children, positions); a dedicated wrapper or a hook is the correct shape.

## 10. Corrections to apply to `docs/limitations.md` (not applied here)

| Line   | Current statement                                                                               | Correction                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21     | The `single` branch makes `Notebook`/`Paned` fail                                               | Correct for `Notebook`/`Paned`/`CenterBox`; `Frame`, `Button`, `ScrolledWindow`, `ListBoxRow`, `CheckButton` and `Overlay` (main child) do work because they implement `setChild` |
| 44     | `none` throws "as soon as a child is declared"                                                  | Throws when a **widget-backed** node is inserted; comments, empty text and null-rendering components are transparent                                                              |
| 59     | `ListView`/`ColumnView`/`GridView` need `Gio.ListStore`/`TreeListModel`/`TreeModel`             | GTK4 views take a `Gtk.SelectionModel`; wrap the store in `SingleSelection`/`MultiSelection`/`NoSelection`                                                                        |
| 60     | The factory and callbacks are "plain objects"                                                   | The factory is a GObject; callbacks are JS functions bridged as signal handlers (GClosures)                                                                                       |
| 66, 68 | No template syntax and no place to create a resource                                            | `:model`/`:factory`/`:menu-model`/`:file` are normal props; a null-rendering component with `provide`/`inject` is a valid place, verified                                         |
| 72     | "A model attribute receives a plain JavaScript value ... cannot turn it into a `Gio.ListModel`" | A **plain JS value** (array) fails; a native GObject succeeds. The real traps are `ref()` proxies and `null` unset                                                                |
| 73     | "A factory cannot be declared as a child"                                                       | A factory is a property, not a child; `:factory` works                                                                                                                            |
| 87-91  | Add `insertChild`/`removeChild`/`attach`; effort S                                              | Agree, with the placement signature in §6.1; roles can come from `node.props.role` without a reconciler change                                                                    |
| 93-97  | Add a resource node; effort M/L                                                                 | Not needed: components + `provide`/`inject` cover it. If one wants it, a `resource` flag is S/M, not a reconciler rewrite                                                         |

## Appendix A — observed messages

```
vio: 'notebook-none' cannot contain children
vio: 'window' accepts one widget child; wrap siblings in VBox
TypeError: parent.widget.setChild is not a function                  (Notebook/Paned/CenterBox, children: "single")
TypeError: box.insertChildAfter is not a function                    (Paned/FlowBox/Fixed/HeaderBar, children: "box")
Error: vio: VListBox children must be VListBoxRow components
TypeError: Cannot convert value "[object Array]" to type GtkSelectionModel
TypeError: Cannot convert value "[object Object]" to type GtkSelectionModel   (ref() proxy)
TypeError: Cannot convert value "null" to type GtkSelectionModel             (setProperty(name, null))
TypeError: Cannot read properties of null (reading 'toString')        (Teleport string target, dev warning path)
Gtk-CRITICAL: gtk_flow_box_child_set_child: assertion ... failed      (FlowBox.insert on an existing child)
```

## Appendix B — reproduction sketch

All experiments were run from the repository with Node 24 and the local node-gtk build:

```bash
node --import ./node_modules/.pnpm/node-gtk@4.1.1_encoding@0.1.14/node_modules/node-gtk/lib/esm/register.mjs script.mjs
```

`script.mjs` imported `packages/vio/src/app/index.ts` directly (Node 24 type stripping) and called
`Gtk.init()` once. The key fragments are in §2.3, §4.1 and §4.5. No visible windows were presented:
`Gtk.ListView` items were realised with `view.allocate(200, 200, -1, null)`, and all other checks
used properties/methods on unmapped widgets.

Evidence from the repository itself:

- keyed identity and property/class reset: `packages/vio/tests/gtk.test.mjs:56-139`;
- fragments/slots/keyed order, signal replacement, error handling:
  `packages/vio/tests/renderer.test.mjs:73-247`;
- SFC `defineExpose`, `v-model`, scoped CSS and `VKeyController`: `packages/vio/tests/gtk.test.mjs:27-54`,
  `packages/vio/tests/Fixture.vue`;
- `createRoot`/`createVioRenderer` public surface: `packages/vio/src/app/index.ts:45-75`,
  `packages/vio/README.md:111`;
- `defineWidgetComponent` and the exposed `widget` handle: `packages/vio/src/modules/gtk/components.ts:5-20`.
