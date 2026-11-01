# Small and special widgets (wave 5)

`packages/vio/src/modules/gtk/small.ts` adds the small GTK widgets that were still missing from the
declarative layer: frames, revealers, ranges, permission and titlebar controls, popovers, shortcut
labels, tree expanders and SVG. Every component is a thin wrapper; the native object is always
reachable through the component ref and `.widget`.

```bash
vp run --filter @zede/vio demo:small   # frames, ranges, popovers, SVG and titlebar widgets
```

## Components

| Component             | GTK widget               | `v-model`                               | Slots                    | Limitations                                                                      |
| --------------------- | ------------------------ | --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `VFrame`              | `Gtk.Frame`              | none                                    | default, `#label-widget` | one content child; the header slot is a role, not a second content child         |
| `VViewport`           | `Gtk.Viewport`           | none                                    | default                  | one child; no `scroll-to` signal on GTK 4.24, use the `scrollTo()` method        |
| `VRevealer`           | `Gtk.Revealer`           | `v-model:revealed` (`boolean`)          | default                  | `revealed-changed` is synthesized from `notify::reveal-child`                    |
| `VAspectFrame`        | `Gtk.AspectFrame`        | none                                    | default (box semantics)  | content is placed in an internal vertical `Gtk.Box`; `shrink-child` is emulated  |
| `VScrollbar`          | `Gtk.Scrollbar`          | `v-model:value` (`number`)              | none                     | value lives on the internal `GtkAdjustment`, not on `Gtk.Scrollbar`              |
| `VScaleButton`        | `Gtk.ScaleButton`        | `v-model:value` (`number`)              | none                     | value/range come from a `GtkAdjustment`                                          |
| `VVolumeButton`       | `Gtk.VolumeButton`       | `v-model:value` (`number`)              | none                     | keeps GTK's default volume icons unless `icons` is set                           |
| `VLockButton`         | `Gtk.LockButton`         | `v-model:permission` (`Gio.Permission`) | none                     | a `null` permission is a valid empty state                                       |
| `VPopoverBin`         | `Gtk.PopoverBin`         | none                                    | default, `#popover`      | `#popover` must contain a `Gtk.Popover`                                          |
| `VEmojiChooser`       | `Gtk.EmojiChooser`       | none                                    | none                     | a popover: it must be parented (for example by `VMenuButton`)                    |
| `VShortcutLabel`      | `Gtk.ShortcutLabel`      | none                                    | none                     | `accelerator` is an accelerator string such as `<Control>s`                      |
| `VTreeExpander`       | `Gtk.TreeExpander`       | none                                    | default                  | GTK 4.24 renamed `indent-for-expander` to `indent-for-depth`                     |
| `VSvgWidget`          | `Gtk.SvgWidget`          | none                                    | none                     | GTK 4.24 exposes `resource`/`bytes`, not `file`/`paintable`                      |
| `VWindowControls`     | `Gtk.WindowControls`     | none                                    | none                     | GTK 4.24 removed `decorative`; `false` hides the controls                        |
| `VWindowHandle`       | `Gtk.WindowHandle`       | none                                    | default                  | one child                                                                        |
| `VColorChooserWidget` | `Gtk.ColorChooserWidget` | `v-model:rgba` (`Gdk.RGBA`)             | none                     | emits on `color-activated`, not on every `notify::rgba`                          |
| `VFontChooserWidget`  | `Gtk.FontChooserWidget`  | `v-model:font` (`string`)               | none                     | GTK 4.24's font getter stays empty; the model is event-driven                    |
| `VGraphicsOffload`    | `Gtk.GraphicsOffload`    | none                                    | default                  | `enabled` accepts `"enabled"`, `"disabled"`, `true`, `false` or the enum         |
| `VAppChooserButton`   | `Gtk.AppChooserButton`   | none                                    | none                     | `content-type` is required and construct-only; invalid values are an empty state |
| `VAppChooserWidget`   | `Gtk.AppChooserWidget`   | none                                    | none                     | `content-type` is required and construct-only; no `populate-popup` on GTK 4.24   |

`VColorChooserWidget`, `VFontChooserWidget` and `VGraphicsOffload` are the wave 5 spare widgets.
Wave 6 adds `VAppChooserButton` and `VAppChooserWidget` in
`packages/vio/src/modules/gtk/app-chooser.ts`: their construct-only `content-type` is passed through
the `WidgetDefinition.constructProps` hook, so no `GLib-GObject-CRITICAL` is logged. The same hook
also makes `<gtk-app-chooser-button content-type="…" />` and
`<gtk-app-chooser-widget content-type="…" />` work. `Gtk.ShortcutsWindow` and its public
section/group/shortcut widgets have dedicated `V*` wrappers (see
[`dialogs.md`](dialogs.md#shortcuts-window)).

## Frames and viewports

```vue
<VFrame label="Details">
  <VLabel>One content child.</VLabel>
  <template #label-widget>
    <VLabel>Custom header</VLabel>
  </template>
</VFrame>

<VViewport :height-request="120">
  <VBox>…</VBox>
</VViewport>
```

- `#label-widget` is routed to `GtkFrame:label-widget`; the default slot is the single content
  child. The header wrapper is released on unmount, so a keyed slot does not leak widgets.
- `VViewport` exposes `scrollTo(descendant, scrollInfo)` on the handle. GTK 4.24
  (`/usr/share/gir-1.0/Gtk-4.0.gir`) has no `GtkViewport::scroll-to` signal; the earlier brief
  described the GTK 3 API. Connecting `@scroll-to` natively fails with `Signal name is invalid`,
  and `tests/small.test.mjs` asserts both facts.
- A viewport is a bin, not a scroller. Put it inside `VScrolledWindow` when a scrollbar is needed.

## Revealer and aspect frame

```vue
<VRevealer v-model:revealed="visible" transition-type="slide-down" :transition-duration="220">
  <VLabel>Animated content</VLabel>
</VRevealer>

<VAspectFrame :ratio="16 / 9" :obey-child="false" :xalign="0.5" :yalign="0.5">
  <VLabel>16:9</VLabel>
</VAspectFrame>
```

- `v-model:revealed` reads and writes `GtkRevealer:reveal-child`. The handle also exposes
  `childRevealed`, the read-only completion flag. `@revealed-changed` is synthesized from
  `notify::reveal-child` (GTK 4.24 has no signal with that name), and the native
  `@notify::child-revealed` remains available.
- `VAspectFrame` is a bin. Vio creates one internal vertical `Gtk.Box` as its child and places all
  default-slot children there, so several children behave like `VBox` content. `ratio`, `obey-child`,
  `xalign` and `yalign` map directly. GTK 4.24 removed `shrink-child`; the prop is accepted and
  approximated with `hexpand`/`vexpand` (`true` shrinks, `false` expands).

## Ranges and volume

```vue
<VScrollbar v-model:value="scroll" :min="0" :max="100" :step="5" orientation="horizontal" />
<VScaleButton v-model:value="scale" :icons="['audio-volume-high-symbolic']" />
<VVolumeButton v-model:value="volume" />
```

- `Gtk.Scrollbar` in GTK 4.24 has only an `adjustment`; it has no `value` property and no
  `value-changed` signal. `VScrollbar` creates a `GtkAdjustment` from `min`/`max`/`step` (like
  `VScale`) and emits `update:value` and `value-changed` from the adjustment. The adjustment is
  exposed as `handle.adjustment`.
- `VScaleButton` and `VVolumeButton` read `value` from the widget and are guarded against echoing a
  prop update. `@value-changed` carries the numeric value. `@popup`/`@popdown` are native
  `GtkScaleButton` signals and are forwarded unchanged. GTK's default `popup` handler realizes a
  popup, so the test verifies the listener wiring and emits `popdown` on a realized widget instead
  of trying to present the popup under a headless display.
- A standalone `Gtk.Scrollbar` on this host warns
  `GtkGizmo … (slider) reported min height -2` (GTK 4.24.1 / theme CSS) unless the theme supplies a
  concrete slider min-size. The demo adds a small global CSS rule; the wrapper itself does not
  change global CSS.

## Permissions and custom titlebars

```vue
<VLockButton v-model:permission="permission" />

<VWindowHandle>
  <VLabel>Drag me</VLabel>
</VWindowHandle>
<VWindowControls side="end" decoration-layout="icon:close" />
```

- `permission` accepts a `Gio.Permission` such as `Gio.SimplePermission.new(true)`. Clearing it to
  `null` calls `setPermission(null)`; `null` is added to the driver's `nullSetters`.
- `Gtk.WindowControls` on 4.24 has `side`, `decoration-layout`, `use-native-controls` and the
  read-only `empty`. The old `decorative` property is gone; `VWindowControls:decorative=false`
  hides the widget as the closest visible equivalent. `side` accepts `"start"`/`"end"` or
  `Gtk.PackType`.
- `VWindowHandle` is a single-child drag surface, typically placed in a `VHeaderBar` with
  `role="titlebar"`.

## Popovers

```vue
<VMenuButton>
  <VLabel>Emoji</VLabel>
  <template #popover>
    <VEmojiChooser @emoji-picked="emoji = $event" />
  </template>
</VMenuButton>

<VPopoverBin>
  <VButton>Open</VButton>
  <template #popover>
    <VPopover>
      <VLabel>Content</VLabel>
    </VPopover>
  </template>
</VPopoverBin>
```

- `VEmojiChooser` wraps `Gtk.EmojiChooser`, which is a `Gtk.Popover`. It must have a parent: put it
  in a menu button or a popover bin. `@emoji-picked` receives the picked emoji as a string;
  `handle.popup()` returns `false` when the chooser is not parented instead of letting GTK warn.
- `VPopoverBin` routes its default slot to `setChild()` and `#popover` to `setPopover()`; the
  popover child must be a `Gtk.Popover`. The native `Gtk.PopoverBin` exposes its own `popup()` /
  `popdown()` methods through `.widget`.

## Labels, tree expanders and SVG

```vue
<VShortcutLabel accelerator="<Control>s" disabled-text="No shortcut" />

<VTreeExpander :indent-for-icon="true" :indent-for-depth="true">
  <VLabel>Row</VLabel>
</VTreeExpander>

<VSvgWidget :bytes="svgBytes" :state="0" :height-request="72" />
```

- `VShortcutLabel` maps `accelerator` and `disabled-text`. `@notify::accelerator` is a normal GTK
  notification.
- GTK 4.24 renamed `Gtk.TreeExpander:indent-for-expander` to `indent-for-depth`. `VTreeExpander`
  accepts both props (the modern `indentForDepth` wins) and only writes the existing property. The
  read-only `item` and `listRow` are exposed through the handle and `getProperty`/`getItem()`.
- `Gtk.SvgWidget` is new in GTK 4.24 in this build (the brief said 4.22). Its real API is
  `resource` (GResource path), `state`, `stylesheet` (`GLib.Bytes`) and the read-only `svg`
  (`Gtk.Svg` paintable), plus `loadFromBytes()`; there is no `file` prop and no `paintable`
  property. `VSvgWidget` keeps the planned input surface by reading `filename`/`file` into
  `GLib.Bytes` and calling `loadFromBytes()`, and accepts `bytes` (`GLib.Bytes`, `Uint8Array` or
  `number[]`). A missing file sets `handle.error` and never hands an empty buffer to GTK.
  `handle.svg` (also aliased as `handle.paintable`) is the `Gtk.Svg` object.
- Removing `filename`/`file`/`bytes` does not clear an already loaded document; GTK 4.24 has no
  unload API for `GtkSvgWidget`. Mount a fresh component (or provide new bytes) to reset it.
- `state` is re-applied after `loadFromBytes()`: loading a document resets the widget state to 0.

## Spare widgets

```vue
<VColorChooserWidget v-model:rgba="rgba" :show-editor="true" />
<VFontChooserWidget v-model:font="font" preview-text="The quick brown fox" />
<VGraphicsOffload enabled="disabled">
  <VLabel>Child</VLabel>
</VGraphicsOffload>
```

- `VColorChooserWidget` maps `rgba`, `show-editor` and `use-alpha`. `v-model:rgba` emits the native
  `Gdk.RGBA` on GTK's `color-activated` signal; consecutive `notify::rgba` emissions are not used
  because `setRgba()` emits twice.
- `VFontChooserWidget` maps `font`/`font-desc`, `language`, `level`, `preview-text` and
  `show-preview-entry`. On GTK 4.24.1 the native font getter returns `null`/`""` even after
  realization, so `v-model:font` is driven by `font-activated` (the string argument) rather than by
  a readback.
- `VGraphicsOffload` maps `enabled` and `black-background`; the enum is `Gtk.GraphicsOffloadEnabled`.

## AppChooser (wave 6)

```vue
<VAppChooserButton
  content-type="image/png"
  heading="Open with"
  :modal="true"
  :show-dialog-item="true"
  @custom-item-activated="(name) => (picked = name)"
  @activate="activated = true"
/>

<VAppChooserWidget
  content-type="image/png"
  :show-default="true"
  :show-recommended="true"
  @application-selected="(app) => (selected = app.getName())"
/>
```

- `content-type` is required and construct-only. It reaches `new Gtk.AppChooserButton({ contentType })`
  through `WidgetDefinition.constructProps`; changing it after mount throws a clear
  `construct-only` error instead of logging `GLib-GObject-CRITICAL`.
- `VAppChooserButton` maps `heading`, `modal`, `show-dialog-item` and `show-default-item`. The handle
  exposes `appendSeparator()`, `appendCustomItem(name, label, icon)` (a `Gio.Icon`) and `activate()`.
- `VAppChooserWidget` maps `show-default`, `show-fallback`, `show-other`, `show-recommended` and
  `show-all`; `application-selected`/`application-activated` receive a `Gio.AppInfo`.
- A missing or invalid `content-type` (`Gio.contentTypeFromMimeType()` returns `null`, or the value
  is not MIME-shaped) creates an empty widget, sets `handle.error` and `handle.available === false`.
- GTK 4.24 has no `GtkAppChooserWidget::populate-popup` signal; use `application-selected` and
  `application-activated`. The generic `gtk-app-chooser-button`/`gtk-app-chooser-widget` elements
  accept the same `content-type` prop.

## Deviations from the wave 5 brief

| Brief                                         | GTK 4.24 reality                              | Wrapper behavior                                       |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `GtkViewport` `@scroll-to`                    | no signal; only `scrollTo()`                  | method on the handle; test asserts the missing signal  |
| `GtkRevealer` `revealed-changed`              | no such signal                                | synthesized from `notify::reveal-child`                |
| `GtkScrollbar` `value`/`value-changed`        | no such property/signal                       | `GtkAdjustment` + synthesized `value-changed`          |
| `GtkAspectFrame` `shrink-child`               | removed in 4.24                               | approximated with `hexpand`/`vexpand`                  |
| `GtkTreeExpander` `indent-for-expander`       | renamed to `indent-for-depth`                 | both props accepted; only the native name is written   |
| `GtkSvgWidget` `file`/`paintable`             | `resource`/`state`/`stylesheet`/`svg` on 4.24 | `filename`/`file`/`bytes` load through `loadFromBytes` |
| `GtkWindowControls` `decorative`              | removed in 4.24                               | `decorative=false` hides the widget                    |
| `GtkAppChooserButton`/`Widget` `content-type` | construct-only                                | passed through `constructProps`; late changes throw    |
| `GtkAppChooserWidget` `populate-popup`        | no such signal on GTK 4.24                    | only the two application signals are forwarded         |

Every deviation is covered by a test that asserts the native surface, not only the wrapper:
`tests/small.test.mjs` checks the missing viewport/scrollbar signals, the renamed tree-expander
property, the absence of `paintable`/`file` on `GtkSvgWidget`, and the `indent-for-depth` mapping.

## Tests and demo

`packages/vio/tests/small.test.mjs` contains 21 tests:

- mount, prop update and unmount for every wave 5 component;
- `v-model:revealed`, `v-model:value`, `v-model:permission`, `v-model:rgba`, `v-model:font`;
- native signal forwarding (`revealed-changed`, `value-changed`, `emoji-picked`,
  `font-activated`, `color-activated`, `popdown`) and listener wiring for `popup`;
- missing-file and unparented-popup empty states;
- a child-process mount of all wave 5 components that asserts zero
  `Gtk-WARNING`/`Gtk-CRITICAL`/`GLib-CRITICAL`/`Gdk-CRITICAL` lines;
- a window-hosted scale-button test in a child process so no nested main loop is created;
- a real `VEmojiChooser`/`VScaleButton` popup test in a shown window, asserting
  `getVisible()`, `getParent()`, `emoji-picked`, `value-changed` and `popdown`.

`packages/vio/tests/app-chooser.test.mjs` adds 7 tests for the explicit and introspected
constructor path, invalid content types and both AppChooser components.

The demo lives in `packages/vio/examples/small` and is registered as `demo:small`. Its non-scoped
CSS adds slider min-size rules for the standalone `Gtk.Scrollbar` and popover scale theme warnings
described above. It also shows an AppChooser scene and buttons that open real emoji/scale popups;
nothing pops up automatically, so `demo:small` stays warning-free under `timeout`.
