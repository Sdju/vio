# Data and panel widgets (wave 2)

`packages/vio/src/modules/gtk/data.ts` adds the collection views, text widgets and panels that need
more than a property mapping: native models and factories, two-way text bindings, and role-based
placement. The components remain thin wrappers over the same renderer and placement hooks.

```bash
vp run --filter @zede/vio demo:data   # shared store in ColumnView + GridView, TreeView columns, search, InfoBar, TextView
```

## Components

| Component             | GTK widget                              | `v-model`                                | Model                                            | Slots                                     | Limitations                                        |
| --------------------- | --------------------------------------- | ---------------------------------------- | ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------- |
| `VColumnView`         | `Gtk.ColumnView`                        | `v-model:selected` (`number`/`number[]`) | `Gio.ListModel`, wrapped in a selection per mode | `#columns` with `VColumnViewColumn`       | columns appended; no column reordering             |
| `VColumnViewColumn`   | `Gtk.ColumnViewColumn` (not a widget)   | none                                     | none                                             | `#cell="{ item, position }"`              | slot root must be a GTK widget                     |
| `VGridView`           | `Gtk.GridView`                          | `v-model:selected` (`number`/`number[]`) | `Gio.ListModel`, wrapped in a selection per mode | `#item="{ item, position }"`              | one factory per view                               |
| `VIconView`           | `Gtk.IconView`                          | `v-model:selected` (`number`/`number[]`) | `Gtk.TreeModel`                                  | none (`#item` throws)                     | legacy model; no widget cells; deprecated upstream |
| `VTextView`           | `Gtk.TextView`                          | `v-model:text`                           | `buffer` prop (`Gtk.TextBuffer`)                 | none                                      | buffer signals coalesced in a microtask            |
| `VEditableLabel`      | `Gtk.EditableLabel`                     | `v-model:text`                           | none                                             | none                                      | equality guard preserves the caret                 |
| `VSearchEntry`        | `Gtk.SearchEntry`                       | `v-model:text`                           | none                                             | none                                      | `search` proxies immediate `changed`, no debounce  |
| `VInscription`        | `Gtk.Inscription`                       | none                                     | none                                             | none; `text` or `markup`                  | `text` and `markup` are mutually exclusive         |
| `VSearchBar`          | `Gtk.SearchBar`                         | manual `search-mode-enabled` pair        | none                                             | default: exactly one `VSearchEntry`       | no SFC `v-model` allowlist entry                   |
| `VActionBar`          | `Gtk.ActionBar`                         | none                                     | none                                             | `#start`, `#end` (default fills `#start`) | inserts/reorders in the internal role box          |
| `VInfoBar`            | `Gtk.InfoBar`                           | none                                     | none                                             | `#content` (default), `#action`           | action items must be activatable widgets           |
| `VStatusbar`          | `Gtk.Statusbar`                         | none                                     | `messages: string[]`                             | none                                      | shows the last message; deprecated upstream        |
| `VTreeView`           | `Gtk.TreeView`                          | none                                     | `Gtk.TreeModel`                                  | `#columns` with `VTreeViewColumn`         | deprecated upstream; use `VColumnView`             |
| `VTreeViewColumn`     | `Gtk.TreeViewColumn` (not a widget)     | none                                     | none                                             | default: cell-renderer wrappers           | native columns are append-only                     |
| `VCellRendererText`   | `Gtk.CellRendererText` (not a widget)   | none                                     | `column` / `modelColumn` index                   | none                                      | `@edited(path, text)`                              |
| `VCellRendererToggle` | `Gtk.CellRendererToggle` (not a widget) | none                                     | `column` / `modelColumn` index                   | none                                      | `@toggled(path)`                                   |
| `VCellRendererPixbuf` | `Gtk.CellRendererPixbuf` (not a widget) | none                                     | `column` / `modelColumn` index                   | none                                      | binds a `GdkPixbuf` model column                   |
| `VListModel`          | none (resource)                         | `selected` prop                          | `items: string[]`                                | none                                      | string items only                                  |

`VColumnView`, `VGridView` and `VIconView` also accept `modelValue` as an alias for `selected`.
In `multiple` mode the value is a `number[]` of positions; in `single` and `none` it is a single
`number` (`-1` when nothing is selected). `VColumnView` and `VGridView` build
`Gtk.SingleSelection` / `Gtk.MultiSelection` / `Gtk.NoSelection` internally from `selection-mode`,
so pass the raw `Gio.ListModel` (`Gio.ListStore`, `Gtk.StringList`, …).

## Lists and factories

```vue
<VColumnView v-model:selected="selected" :model="store" selection-mode="single">
  <template #columns>
    <VColumnViewColumn title="Name" :expand="true">
      <template #cell="{ item, position }">
        <VLabel>{{ position + 1 }}. {{ item?.getString() }}</VLabel>
      </template>
    </VColumnViewColumn>
  </template>
</VColumnView>

<VGridView :model="store">
  <template #item="{ item }">
    <VLabel>{{ item?.getString() }}</VLabel>
  </template>
</VGridView>
```

- A column owns one `Gtk.SignalListItemFactory`. `#cell` receives `{ item, position }` and is
  rendered into a detached root owned by the `Gtk.ListItem`; the root of the slot must be an
  ordinary GTK widget. The renderer inserts it into a `Gtk.Box` host that is the list item child.
- `Gtk.GridView` uses one factory for `#item`.
- On `unbind` the teleported content is removed; on `teardown` the host is detached. A scroll,
  reorder or model reset therefore recycles cells without leaking widgets.
- On unmount the columns call `setFactory(null)` and the views call `setModel(null)` /
  `setFactory(null)`, so no JS callback stays referenced by a live GObject.
- `VColumnViewColumn` is not a widget: `#columns` children do not become GTK child widgets. Only
  `VColumnViewColumn` declarations belong there.
- Columns are appended in declaration order on the initial mount. A column added later is appended
  at the end; reordering existing columns is not implemented.

`VGridView` maps `min-columns` / `max-columns` to the native properties.

`VListModel` moved to `data.ts`; its API is unchanged. `useListModel(items, factory)` builds the
same `Gio.ListStore` + `Gtk.SingleSelection` pair for custom views.

## Text and search

`VTextView` owns a `Gtk.TextBuffer` unless a `buffer` prop is supplied. `v-model:text` is driven by
the buffer `changed` signal; programmatic prop updates are guarded so they do not echo back into the
model. The signal is coalesced in a microtask because `Gtk.TextBuffer.setText()` emits a
delete/insert pair synchronously. `wrap-mode` accepts `none`, `char`, `word` and `word-char`;
`editable` and `monospace` are forwarded.

`VEditableLabel` only writes `text` when the prop actually differs from `getText()`. GTK emits
`notify::text` even for an equal `setText()` call, which would move the caret; the equality guard
keeps the caret in place when a parent re-render does not change the value.

`VSearchEntry` binds `text` and `placeholder-text`. GTK4 removed `GtkSearchEntry::search`; the
surviving `search-changed` signal applies GTK's own 150 ms delay. `VSearchEntry` therefore proxies
the immediate `GtkEditable::changed` signal to `@search`, coalescing a synchronous delete/insert
burst in a microtask. The event has **no debounce**; debouncing is the caller's responsibility:

```vue
<VSearchEntry v-model:text="query" @search="applyFilter" />
```

`VInscription` accepts `text` or `markup` (not both), `nat-chars`, `nat-lines` and `text-overflow`
(`clip`, `start`, `middle`, `end`). It has no widget children.

## Panels

`VSearchBar` requires a `VSearchEntry` child. The check runs in the placement hook, so a wrong child
fails during mount with:

```text
vio: 'VSearchBar' requires a VSearchEntry child
```

The bar calls `connectEntry()` on the child. `search-mode-enabled` is two-way through the normal
prop/event pair (`:search-mode-enabled` + `@update:search-mode-enabled`); `VSearchBar` is not in the
SFC `v-model` allowlist, so `v-model:search-mode-enabled` is rejected at compile time.

`VActionBar` reads `#start` and `#end`. Like `VHeaderBar`, the role children live in an internal
`Gtk.Box`; after the first insert, a keyed move is a public `Gtk.Box.reorderChildAfter()` call, so
siblings are not detached and wrappers keep their identity. `packStart` / `packEnd` run only for
the initial empty role group.

`VInfoBar` uses `Gtk.InfoBar.addChild()` for `#content` and
`Gtk.InfoBar.addActionWidget()` for `#action` (verified on GTK 4.24). `addActionWidget()` warns for
non-activatable widgets, so each action item is routed widget-by-widget instead of through a box
wrapper. `response` and `close` are native signals and are forwarded unchanged:

```vue
<VInfoBar message-type="warning" :show-close-button="true" @response="close" @close="close">
  <template #content><VLabel>Careful</VLabel></template>
  <template #action><VButton>Dismiss</VButton></template>
</VInfoBar>
```

`message-type` accepts `info`, `warning`, `question`, `error`, `other`.

`VStatusbar` keeps `messages: string[]` in full sync: `remove_all(context_id)` followed by `push`
in array order. GTK's statusbar shows the last pushed message. `.widget` on the component ref is the
escape hatch for the rest of the statusbar API.

## TreeView columns

`VTreeView` remains a wrapper around a real `Gtk.TreeModel`, but columns no longer have to be
assembled imperatively. `VTreeViewColumn` owns one real `Gtk.TreeViewColumn`; its default slot
contains cell-renderer wrapper components, each of which owns the corresponding real
`Gtk.CellRendererText`, `Gtk.CellRendererToggle` or `Gtk.CellRendererPixbuf`. These wrappers are not
internal GTK parts: they are the actual renderer objects, exposed as `handle.renderer` / `.widget`.

```vue
<VTreeView :model="treeStore" :headers-visible="true">
  <template #columns>
    <VTreeViewColumn title="Name" :expand="true" :resizable="true" :sort-column-id="0">
      <VCellRendererText :column="0" :editable="true" @edited="onEdited" />
    </VTreeViewColumn>
    <VTreeViewColumn title="Active" :sort-column-id="1">
      <VCellRendererToggle :column="1" @toggled="onToggled" />
    </VTreeViewColumn>
    <VTreeViewColumn title="Icon">
      <VCellRendererPixbuf :column="2" />
    </VTreeViewColumn>
  </template>
</VTreeView>
```

| Prop (column)    | Native property                     |
| ---------------- | ----------------------------------- |
| `title`          | `Gtk.TreeViewColumn:title`          |
| `expand`         | `:expand`                           |
| `resizable`      | `:resizable`                        |
| `sort-column-id` | `:sort-column-id` (`-1` = unsorted) |
| `min-width`      | `:min-width` when non-negative      |

| Renderer              | Default attribute | Model binding / events                                                     |
| --------------------- | ----------------- | -------------------------------------------------------------------------- |
| `VCellRendererText`   | `text`            | `column`/`model-column` index; `editable`, `xalign`, `@edited(path, text)` |
| `VCellRendererToggle` | `active`          | `column`/`model-column` index; `activatable`, `radio`, `@toggled(path)`    |
| `VCellRendererPixbuf` | `pixbuf`          | `column`/`model-column` index                                              |

`column` and `modelColumn` are aliases; a non-negative value calls
`Gtk.TreeViewColumn.addAttribute(renderer, attribute, index)`. Use `attribute` to bind a different
renderer property to the same model column. Columns are appended in declaration order and removed
from the view on unmount; GTK has no column insertion/reorder API, so a reorder is a remove plus
append if you do it imperatively.

node-gtk 4.1.1 cannot synthesize `::edited`/`::toggled` with `GObject.emit` (static-scope string
conversion fails) and `GObject.signalEmitv` crashes for those GValues. The components still connect
the native handlers; their handles expose `emitEdited(path, text)` / `emitToggled(path)`, which call
the same forwarding function for tests and tools. A real edit in the view reaches that function from
GTK ([`limitations.md`](limitations.md)).

## Deprecated upstream

- `Gtk.TreeView` is deprecated since GTK 4.10. `VTreeView` is a wrapper around `model`
  (`Gtk.TreeModel`), `headers-visible`, `reorderable` and the declarative column/renderer
  components above. **Use `VColumnView` for new code.**
- `Gtk.Statusbar` is deprecated since GTK 4.10. `VStatusbar` is kept for existing layouts, but no
  other API should be built on it.
- `Gtk.InfoBar` is deprecated since GTK 4.10. It still works on 4.24 and remains the only native
  info bar; prefer a plain `VBox` for new decorative banners.
- `Gtk.IconView` is deprecated since GTK 4.10 and its `model` property is a legacy `Gtk.TreeModel`,
  not a `Gio.ListModel`. `VIconView` cannot host widget cells; use `VGridView`.

`createTreeListModel(listStore, childrenFunc)` wraps a flat `Gio.ListModel` in a
`Gtk.TreeListModel`. On GTK 4.24 that model implements only `Gio.ListModel` (verified with
`GObject.typeIsA`: it does **not** implement `Gtk.TreeModel`), so it feeds a `VColumnView` through a
selection, not `VTreeView`. `VTreeView` keeps taking a real `Gtk.TreeModel` such as `Gtk.TreeStore`
or `Gtk.ListStore`; its columns are described with `VTreeViewColumn` and the cell-renderer wrappers.
