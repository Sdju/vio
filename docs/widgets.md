# Generic GTK widgets from introspection

`@zede/vio` can create any widget class exposed by the Gtk namespace without a manual
`registerWidget()` call. A `gtk-*` element that has no explicit registration is resolved from
GObject Introspection:

```vue
<gtk-calendar :show-heading="false" />
<gtk-frame label="Frame">
  <VLabel>one child</VLabel>
</gtk-frame>
<gtk-level-bar :value="0.65" />
<gtk-popover-menu :menu-model="menu" />
```

The resolver lives in `packages/vio/src/modules/gtk/introspected.ts` and is exported from
`@zede/vio`:

| Function                        | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `resolveIntrospected(type)`     | `WidgetDefinition` for a kebab-case class, or `undefined` |
| `listIntrospectedWidgetTypes()` | kebab-case names of every Gtk widget class                |
| `isIntrospectedType(type)`      | whether introspection can create this class               |

## Resolution rules

The GTK driver looks a type up in this order:

1. The explicit registry (`registerWidget()` and the built-in definitions).
2. The internal `div` storage container used by `KeepAlive`.
3. Introspection, by converting the kebab-case name to a PascalCase Gtk class name:
   `popover-menu` → `PopoverMenu`, `color-dialog-button` → `ColorDialogButton`.

An introspected type is accepted only when the class exists in the Gtk namespace, is a constructor
function, and its prototype inherits `Gtk.Widget.prototype`. The definition is cached per type, but
the widget itself is created on every `create()` call, exactly like an explicit registration.

`gtk-` is stripped by the renderer before the driver sees the name, so both `resolveIntrospected`
and `isIntrospectedType` also accept names with the prefix. `listIntrospectedWidgetTypes()` returns
names without it. `ComboBox` and `ComboBoxText` also accept the GTK CSS spellings `combobox` and
`combobox-text`.

Explicit registrations always win: the built-in types (`window`, `box`, `label`, `entry`,
`button`, `image`, `list-box`, `list-box-row`, `scrolled-window`, `grid`, `stack`, `separator`,
`spinner`, `switch`, `check-button`, `key-controller`, the `vio-*` containers and `list-view`) keep
their behavior and their order in `getWidgetTypes()`.

## Construct-only properties

Some GTK properties may only be passed to the constructor. The introspected definition carries a
`constructProps` list generated from `GParamFlags.CONSTRUCT_ONLY`, and the renderer passes the VNode
props to `createElement()`/`WidgetDefinition.create(props?)`:

```vue
<gtk-app-chooser-button content-type="image/png" />
<gtk-app-chooser-widget content-type="image/png" :show-all="true" />
```

The value is applied by `new Gtk.AppChooserButton({ contentType: "image/png" })`; a repeated
`setProperty()` is skipped, and a later change throws a clear `construct-only` error. Every widget
also inherits construct-only `css-name`. The complete class → property table and the extension
contract are in [`limitations.md`](limitations.md#construct-only-properties).

## Explicit registry vs introspection

|                       | Explicit registry                           | Introspection                                  |
| --------------------- | ------------------------------------------- | ---------------------------------------------- |
| Created by            | `registerWidget()` / built-in `definitions` | `Gtk[PascalCase]` with widget inheritance      |
| Child placement       | Any `ChildrenMode` or `insertChild` hooks   | `single` for the allowlist, `none` otherwise   |
| Role slots / ordering | Full control                                | None: plain `setChild()` for `single`          |
| Listed by             | `getWidgetTypes()`, `hasWidget()`           | `listIntrospectedWidgetTypes()`                |
| Use when              | A container needs placement or roles        | A leaf widget or a simple single-child wrapper |

`getWidgetTypes()` intentionally does not grow when a generic widget is used: it remains the
diagnostic list of explicit registrations. Use `listIntrospectedWidgetTypes()` for the full set.

## Child modes

The child mode of an introspected container is an **explicit allowlist**, not a method probe.
Only these classes get `single` and accept one child through `setChild()`:

| kebab name               | Gtk class                 |
| ------------------------ | ------------------------- |
| `frame`                  | `Gtk.Frame`               |
| `aspect-frame`           | `Gtk.AspectFrame`         |
| `expander`               | `Gtk.Expander`            |
| `revealer`               | `Gtk.Revealer`            |
| `viewport`               | `Gtk.Viewport`            |
| `search-bar`             | `Gtk.SearchBar`           |
| `dialog`                 | `Gtk.Dialog`              |
| `message-dialog`         | `Gtk.MessageDialog`       |
| `about-dialog`           | `Gtk.AboutDialog`         |
| `application-window`     | `Gtk.ApplicationWindow`   |
| `shortcuts-window`       | `Gtk.ShortcutsWindow`     |
| `toggle-button`          | `Gtk.ToggleButton`        |
| `link-button`            | `Gtk.LinkButton`          |
| `menu-button`            | `Gtk.MenuButton`          |
| `popover`                | `Gtk.Popover`             |
| `popover-menu`           | `Gtk.PopoverMenu`         |
| `tree-expander`          | `Gtk.TreeExpander`        |
| `window-handle`          | `Gtk.WindowHandle`        |
| `flow-box-child`         | `Gtk.FlowBoxChild`        |
| `graphics-offload`       | `Gtk.GraphicsOffload`     |
| `lock-button`            | `Gtk.LockButton`          |
| `emoji-chooser`          | `Gtk.EmojiChooser`        |
| `assistant`              | `Gtk.Assistant`           |
| `file-chooser-dialog`    | `Gtk.FileChooserDialog`   |
| `color-chooser-dialog`   | `Gtk.ColorChooserDialog`  |
| `font-chooser-dialog`    | `Gtk.FontChooserDialog`   |
| `app-chooser-dialog`     | `Gtk.AppChooserDialog`    |
| `print-unix-dialog`      | `Gtk.PrintUnixDialog`     |
| `page-setup-unix-dialog` | `Gtk.PageSetupUnixDialog` |

Every entry above was verified on GTK 4.24 by creating the widget and checking that
`setChild(label)` accepts the label. The test now asserts `child.getParent() === parent` for every
class in the table **except** four real exceptions, which use a private GTK content container:

| Exception       | Intermediate parent | Reason                                                           |
| --------------- | ------------------- | ---------------------------------------------------------------- |
| `menu-button`   | `GtkGizmo`          | `GtkMenuButton::setChild()` installs the content in its Gizmo    |
| `popover`       | `GtkPopoverContent` | `setChild()` installs the content in the private popover content |
| `popover-menu`  | `GtkPopoverContent` | inherits Popover's private content container                     |
| `emoji-chooser` | `GtkPopoverContent` | inherits Popover's private content container                     |

For those four the test asserts `getParent() !== parent` **and** that the parent is still an
ancestor; the old soft `rootOf()` check was removed. `Gtk.DragIcon` is **not** in the list:
`setChild()` realizes the icon and crashes without a drag surface. `Gtk.ScaleButton` has no
`setChild()` method at all. Neither class is inferred by method probing.

### Wave 3: windows and dialogs

Wave 3 registers explicit `vio-*` types at the end of `getWidgetTypes()`, leaving the order of all
wave 1 and wave 2 types unchanged:

| Explicit type                | Component              | Native class              | Notes                           |
| ---------------------------- | ---------------------- | ------------------------- | ------------------------------- |
| `vio-application-window`     | `VApplicationWindow`   | `Gtk.ApplicationWindow`   | content + `role="titlebar"`     |
| `vio-assistant`              | `VAssistant`           | `Gtk.Assistant`           | pages are role children         |
| `vio-dialog`                 | `VDialog`              | `Gtk.Dialog`              | `#content` → `getContentArea()` |
| `vio-message-dialog`         | `VMessageDialog`       | `Gtk.MessageDialog`       | no widget children              |
| `vio-file-chooser-dialog`    | `VFileChooserDialog`   | `Gtk.FileChooserDialog`   | no widget children              |
| `vio-color-chooser-dialog`   | `VColorChooserDialog`  | `Gtk.ColorChooserDialog`  | no widget children              |
| `vio-font-chooser-dialog`    | `VFontChooserDialog`   | `Gtk.FontChooserDialog`   | no widget children              |
| `vio-print-unix-dialog`      | `VPrintUnixDialog`     | `Gtk.PrintUnixDialog`     | no widget children              |
| `vio-page-setup-unix-dialog` | `VPageSetupUnixDialog` | `Gtk.PageSetupUnixDialog` | no widget children              |
| `vio-about-dialog`           | `VAboutDialog`         | `Gtk.AboutDialog`         | no widget children              |

`VFileChooserNative`, `VAlertDialog`, `VFileDialog`, `VColorDialog`, `VFontDialog` and
`VAppChooserDialog` are null-rendering controllers; they do not register element types. The raw
`gtk-*` allowlist entries for the same classes (`dialog`, `message-dialog`, `about-dialog`,
`file-chooser-dialog`, …) keep their wave 1 `single` behavior; the `vio-*` types own the richer
placement. See [`dialogs.md`](dialogs.md).

Deprecations: `Gtk.Dialog`, `Gtk.MessageDialog`, `Gtk.FileChooserDialog`,
`Gtk.FileChooserNative`, `Gtk.ColorChooserDialog`, `Gtk.FontChooserDialog`,
`Gtk.AppChooserDialog` and `Gtk.Assistant` are deprecated since GTK 4.10. The wave 3 wrappers stay
functional on 4.24 and point at `Gtk.AlertDialog`, `Gtk.FileDialog`, `Gtk.ColorDialog` and
`Gtk.FontDialog` for new code. `Gtk.ShortcutsWindow` is intentionally not wrapped; its content is
built from internal `ShortcutsSection`/`ShortcutsGroup` parts and non-widget `Gtk.Shortcut`
resources.

### Wave 4: media, canvas and value pickers

Wave 4 adds no explicit `vio-*` child containers and no new `singleChildTypes` entries. Its
components use the introspected classes directly; `getWidgetTypes()` keeps the wave 1–3 order and
content.

| Component            | Resolved type         | Role                                     |
| -------------------- | --------------------- | ---------------------------------------- |
| `VPicture`           | `picture`             | leaf, `none`                             |
| `VVideo`             | `video`               | leaf, `none`                             |
| `VMediaControls`     | `media-controls`      | leaf, `none` (internal buttons)          |
| `VDrawingArea`       | `drawing-area`        | leaf, `none`                             |
| `VGLArea`            | `gl-area`             | leaf, `none`                             |
| `VColorButton`       | `color-button`        | leaf, `none`                             |
| `VFontButton`        | `font-button`         | leaf, `none`                             |
| `VColorDialogButton` | `color-dialog-button` | leaf, `none`                             |
| `VFontDialogButton`  | `font-dialog-button`  | leaf, `none`                             |
| `VCalendar`          | `calendar`            | leaf, `none`                             |
| `VMediaFile`         | none                  | null-rendering `Gtk.MediaFile` resource  |
| `VStringList`        | none                  | null-rendering `Gtk.StringList` resource |
| `VFilterListModel`   | none                  | null-rendering filter model              |
| `VSortListModel`     | none                  | null-rendering sort model                |

`Gtk.Video`, `Gtk.MediaControls`, `Gtk.DrawingArea`, `Gtk.GLArea` and the pickers have no
`setChild()` slot, so a widget child is still rejected with
`vio: '<type>' cannot contain children`. None of them was added to the `single` allowlist. The
list-model components are deliberately not elements: a resource has no widget and returns `null`
from render, exactly like `VListModel`. Wave 4 details and deviations are in
[`media.md`](media.md).

`menu-button` and `expander` also have explicit registrations in `controls.ts` so `VMenuButton` can
route `#popover` to `setPopover()` and `VExpander` can route `#label` to `setLabelWidget()`. Their
generic `gtk-*` elements keep the same one-child behavior described here.

### Wave 5: small and special widgets

Wave 5 adds three explicit `vio-*` types for containers whose placement is not a plain `setChild()`;
the remaining components use the introspected classes directly. `getWidgetTypes()` gains only the
explicit names, so wave 1–4 order and content are unchanged.

| Explicit type      | Component      | Native class      | Placement                                                      |
| ------------------ | -------------- | ----------------- | -------------------------------------------------------------- |
| `vio-frame`        | `VFrame`       | `Gtk.Frame`       | default child → `setChild`; `#label-widget` → `setLabelWidget` |
| `vio-aspect-frame` | `VAspectFrame` | `Gtk.AspectFrame` | children go into an internal vertical `Gtk.Box` child          |
| `vio-popover-bin`  | `VPopoverBin`  | `Gtk.PopoverBin`  | default child → `setChild`; `#popover` → `setPopover`          |

Wave 5 leaf components resolve their classes through introspection: `viewport`, `revealer`,
`scrollbar`, `scale-button`, `volume-button`, `lock-button`, `emoji-chooser`, `shortcut-label`,
`tree-expander`, `svg-widget`, `window-controls`, `window-handle`, `color-chooser-widget`,
`font-chooser-widget` and `graphics-offload`. The generic `gtk-frame`, `gtk-aspect-frame`,
`gtk-viewport` and `gtk-revealer` elements keep the wave 1 `single` allowlist behavior; use the
`V*` components when a label slot, a revealer model or the aspect-frame box behavior is needed.
Details and deviations: [`small.md`](small.md).

### Wave 2: what was verified and deliberately not added

The wave 2 classes were probed on GTK 4.24 before touching the allowlist. No new class was added:

| Class           | Child API                                       | Allowlist decision                              |
| --------------- | ----------------------------------------------- | ----------------------------------------------- |
| `SearchBar`     | `setChild()`                                    | already listed (before wave 2)                  |
| `ActionBar`     | `packStart()` / `packEnd()`                     | not `setChild`; `vio-action-bar` owns placement |
| `InfoBar`       | `addChild()` / `addActionWidget()`              | not `setChild`; `vio-info-bar` owns placement   |
| `Statusbar`     | none (`push()` adds text, not a widget)         | not a container; `VStatusbar` takes `messages`  |
| `ColumnView`    | `appendColumn()` / `insertColumn()` add columns | not widget children; `#columns` is `none`       |
| `GridView`      | `setFactory()` builds item widgets              | not a child slot; `#item` uses a factory        |
| `IconView`      | `packStart()` adds cell renderers               | not widget children; `VIconView` is `none`      |
| `TreeView`      | `appendColumn()` adds columns                   | not widget children; `VTreeView` is `none`      |
| `TextView`      | `addChildAtAnchor()` is a text-overlay API      | not a child container; `VTextView` is `none`    |
| `Inscription`   | none                                            | leaf; `VInscription` is `none`                  |
| `EditableLabel` | none                                            | leaf; `VEditableLabel` is `none`                |
| `SearchEntry`   | none                                            | leaf; `VSearchEntry` is `none`                  |

Adding any of these to `singleChildTypes` would make a VNode child look like a valid child (or, for
`ColumnView`/`TreeView`, like a column) and then fail or corrupt the model. Containers that need
placement get an explicit `insertChild` / `removeChild` hook instead; see
[`data.md`](data.md) for `VActionBar`, `VInfoBar` and the collection views.

### Deprecated classes in wave 2

- `Gtk.TreeView` and `Gtk.Statusbar` are deprecated since GTK 4.10. `VTreeView` is a thin
  `Gtk.TreeModel` wrapper and `VStatusbar` exists for existing layouts; new code should use
  `VColumnView` and a regular `VBox`.
- `Gtk.InfoBar` and `Gtk.IconView` are deprecated since GTK 4.10 as well. They still work on 4.24;
  `VInfoBar` and `VIconView` document the native API they expose. `VIconView` uses `Gtk.TreeModel`,
  not `Gio.ListModel`, and cannot host widget cells.

Every other introspected class is `none`. A widget child inserted into it throws
`vio: '<type>' cannot contain children`; it is never silently ignored. A second child in a
`single` container throws
`vio: '<type>' accepts one widget child; wrap siblings in VBox`.

### Why not infer the mode from methods

A widget that has an `append()` or `packStart()` method is not necessarily a widget container:

- `Gtk.ComboBoxText.append()` appends a **string item**, not a child widget.
- `Gtk.TreeView`, `Gtk.IconView` and `Gtk.CellView` expose `append` / `packStart` for columns and
  cells, not for child widgets.

Inferring from method presence would make those widgets accept a VNode child and either crash or
silently add data in the wrong place. If a container needs a real placement strategy, register it
explicitly and implement `insertChild` / `removeChild`; see [`containers.md`](containers.md) and
[`limitations.md`](limitations.md).

## Coverage

```ts
import { getWidgetTypes, listIntrospectedWidgetTypes } from "@zede/vio";

getWidgetTypes(); // explicit registrations only, in registration order
listIntrospectedWidgetTypes(); // e.g. ["about-dialog", "action-bar", "calendar", …]
```

On GTK 4.24 the introspection list contains 104 widget classes. The difference between that list
and `getWidgetTypes()` is what the generic resolver covers.

## Errors

Unknown classes fail with suggestions from the introspected list:

```text
vio: unknown widget 'no-such-widget'; no such Gtk class. Did you mean notebook, about-dialog, …
```

A class that exists but is not a widget gets a targeted error:

```text
vio: 'css-provider' is not a Gtk.Widget
```

## Native handles through refs

`gtk-*` elements are plain elements, so a Vue `ref` receives the host `VioElement`:

```vue
<script setup lang="ts">
import { ref } from "@zede/vio";

const calendar = ref();

function focus() {
  calendar.value?.widget?.grabFocus();
}
</script>

<template>
  <gtk-calendar ref="calendar" />
</template>
```

`ref()` must not receive native GObject values: use `shallowRef` or `useNative()` for models,
factories, files and menus. For a widget handle created in `setup`, keep it in a shallow ref and
call methods imperatively; only component refs (`.widget`) are populated by the renderer.

## Root widgets

`createRoot(widget)` uses the same definitions for the root child mode. `createRoot(new Gtk.Frame())`
places its child through `setChild()`, and `createRoot(new Gtk.Calendar())` uses `none` instead of
the legacy `single` fallback, so it no longer reaches `setChild is not a function`.
