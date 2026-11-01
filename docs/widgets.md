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
`setChild(label)` accepts the label. Most classes parent it directly; `menu-button`, `popover`,
`popover-menu` and `emoji-chooser` place it in GTK's internal content container, but `getChild()`
returns it and the widget is an ancestor of the label. `Gtk.DragIcon` is **not** in the list:
`setChild()` realizes the icon and crashes without a drag surface. `Gtk.ScaleButton` has no
`setChild()` method at all. Neither class is inferred by method probing.

`menu-button` and `expander` also have explicit registrations in `controls.ts` so `VMenuButton` can
route `#popover` to `setPopover()` and `VExpander` can route `#label` to `setLabelWidget()`. Their
generic `gtk-*` elements keep the same one-child behavior described here.

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
