# Controls and layout widgets (wave 1)

The components in `packages/vio/src/modules/gtk/controls.ts` add the parts that introspection cannot
express: two-way bindings, role slots with dedicated GTK setters, and a few props that live on an
adjustment or a native model. They are thin wrappers over the existing renderer; no reconciler
mechanics are specific to them.

`v-model` in SFC templates is allowed only for the components listed here, `VEntry`, and the wave 2
data components in [`data.md`](data.md). Any other tag still fails at compile time with
`vio: v-model is supported on VEntry and the V* control components`.

## Components

| Component         | GTK widget           | `v-model`                            | Child positions                                                                 |
| ----------------- | -------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `VToggleButton`   | `Gtk.ToggleButton`   | `v-model:active` (also `modelValue`) | default slot, or `#group` as an alias; one child through `setChild()`           |
| `VLinkButton`     | `Gtk.LinkButton`     | none                                 | default slot; one child through `setChild()`; `uri` is required                 |
| `VMenuButton`     | `Gtk.MenuButton`     | none                                 | default slot is the button content (`setChild()`); `#popover` or `popover` prop |
| `VPopover`        | `Gtk.Popover`        | none                                 | default slot; one child through `setChild()`                                    |
| `VPopoverMenu`    | `Gtk.PopoverMenu`    | none                                 | default slot; one child through `setChild()`; `menu-model` prop                 |
| `VPopoverMenuBar` | `Gtk.PopoverMenuBar` | none                                 | no widget children; `menu-model` prop                                           |
| `VExpander`       | `Gtk.Expander`       | `v-model:expanded`                   | default slot is the content (`setChild()`); `#label` is the header              |
| `VProgressBar`    | `Gtk.ProgressBar`    | `v-model:value`, `v-model:text`      | no widget children; `show-text`                                                 |
| `VLevelBar`       | `Gtk.LevelBar`       | `v-model:value`                      | no widget children; `mode="continuous"` / `"discrete"`                          |
| `VScale`          | `Gtk.Scale`          | `v-model:value`                      | no widget children; `min`, `max`, `step`, `draw-value`, string `orientation`    |
| `VSpinButton`     | `Gtk.SpinButton`     | `v-model:value`                      | no widget children; `min`, `max`, `step`, `digits`                              |
| `VDropDown`       | `Gtk.DropDown`       | `v-model` (selected index)           | no widget children; `model` is a `Gio.ListModel`                                |
| `VComboBoxText`   | `Gtk.ComboBoxText`   | `v-model:text` (active id)           | no widget children; items come from `items: string[]`                           |
| `VPasswordEntry`  | `Gtk.PasswordEntry`  | `v-model:text`                       | no widget children; `show-peek-icon`                                            |
| `VStackSwitcher`  | `Gtk.StackSwitcher`  | none                                 | no widget children; required `stack` prop                                       |
| `VStackSidebar`   | `Gtk.StackSidebar`   | none                                 | no widget children; required `stack` prop                                       |

`VFrame`, `VAspectFrame`, `VRevealer` and `VViewport` were deliberately **not** added: their
generic `gtk-*` elements already accept exactly one child through `setChild()` and forward all
attributes, so a wrapper would add no API.

## MenuButton: `setChild()` is not `setPopover()`

`Gtk.MenuButton` has two independent slots:

- `setChild(widget)` installs the **button content** (a label, a box, an icon, …).
- `setPopover(popover)` installs the **popup**.

`VMenuButton` keeps them separate. The default slot goes through `setChild()`; `#popover` builds a
`Gtk.Popover` and goes through `setPopover()`. A native popover can also be passed directly:

```vue
<VMenuButton :popover="nativePopover">
  <VLabel>Open</VLabel>
</VMenuButton>

<VMenuButton>
  <VLabel>Open</VLabel>
  <template #popover>
    <VBox><VLabel>Popup content</VLabel></VBox>
  </template>
</VMenuButton>
```

Use one form at a time. The `#popover` slot is the popover **content**; `VMenuButton` creates the
`Gtk.Popover` around it. For custom popover properties, create a `Gtk.Popover` in `setup`, keep it in
`useNative()`, and pass it through the `popover` prop.

## Expander: content and label widget

`Gtk.Expander` also has two slots:

- `setChild(widget)` — the collapsible content.
- `setLabelWidget(widget)` — the header widget, replacing the plain `label` string.

```vue
<VExpander v-model:expanded="open">
  <template #label><VLabel>Details</VLabel></template>
  <VBox><VLabel>Hidden content</VLabel></VBox>
</VExpander>
```

`label` is still available for a plain string header. `#label` wins when both are present. The
component listens to `notify::expanded`, so the model follows clicks and `setExpanded()` calls.

## Value models

- `VProgressBar` maps `v-model:value` to `Gtk.ProgressBar:fraction` (0…1). `v-model:text` maps to
  the `text` property. Without a `text` binding the component does not set it, so `show-text` keeps
  GTK's automatic percentage.
- `VLevelBar` maps `v-model:value` to `Gtk.LevelBar:value`. The `mode` prop accepts the strings
  `continuous` and `discrete`.
- `VScale` and `VSpinButton` own a `Gtk.Adjustment` built from `min`, `max` and `step`. `VScale`
  updates the adjustment rather than the `value` property because node-gtk does not expose
  `Gtk.Scale:value` through `getProperty()` / `setProperty()`. `VSpinButton` also accepts `digits`.
- `VDropDown` takes a native `Gio.ListModel` (`Gio.ListStore`, `Gtk.StringList`, …) and binds the
  selected index. Passing `model: null` calls `setModel(null)`.
- `VComboBoxText` never accepts VNode children. Set `items: string[]`; each string is appended as
  both id and label, so `v-model:text` matches the visible text. For custom ids, call
  `append(id, label)` on the exposed `.widget` or pass a custom widget handle.
- `VPasswordEntry` binds `text` and forwards `show-peek-icon`.
- `VPopoverMenu` and `VPopoverMenuBar` take `menu-model`; setting it to `null` clears it through
  `setMenuModel(null)`.

## Stack binding

`Gtk.StackSwitcher` and `Gtk.StackSidebar` do not create a stack; they attach to an existing one.
Pass the native stack through the `stack` prop. If it is missing, setup throws:

```text
vio: 'VStackSwitcher' requires a stack prop
```

`VStack` exposes its native widget through a component ref:

```vue
<VStack ref="stack">
  <VBox name="one">…</VBox>
  <VBox name="two">…</VBox>
</VStack>
<VStackSwitcher v-if="stack?.widget" :stack="stack.widget" />
```

The `v-if` guard is required because a template ref is populated only after the first mount. Without
it, `VStackSwitcher` would receive `null` during the initial render and throw by design.

## Popovers

`VPopover` forwards `relative-to` (a native widget) and `pointing-to` (a `Gdk.Rectangle`) as normal
props. Keep native objects in `useNative()` / `shallowRef()`; never in a deep `ref()`. The GTK
`closed` signal is forwarded by the renderer, so `@closed` works unchanged.

```vue
<VPopover :relative-to="buttonWidget" :pointing-to="rectangle" @closed="closed = true">
  <VLabel>popover</VLabel>
</VPopover>
```

## Single-child allowlist

Wave 1 extended the introspected `single` allowlist with the verified classes listed in
[`widgets.md`](widgets.md#child-modes). `ComboBox` and `ComboBoxText` remain `none`: `append()` adds
a string item, not a child widget.
