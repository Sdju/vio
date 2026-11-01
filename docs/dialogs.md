# Windows and dialogs (wave 3)

`packages/vio/src/modules/gtk/dialogs.ts` adds window roots and the GTK dialog family. Synchronous
dialogs are ordinary GTK widgets (or thin controllers for non-widget GObjects); asynchronous
dialogs are Promise-based controllers built on `Gtk.AlertDialog`, `Gtk.FileDialog`,
`Gtk.ColorDialog` and `Gtk.FontDialog`.

```bash
vp run --filter @zede/vio demo:dialogs
```

Everything here was exercised on **GTK 4.24.1** (`Gtk.getMajorVersion()` 4,
`Gtk.getMinorVersion()` 24, `Gtk.getMicroVersion()` 1) through `node-gtk` 4.1.1.

## Components

| Component              | Native object                    | `v-model`              | Slots / children                   | Limitations                                                    |
| ---------------------- | -------------------------------- | ---------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `VWindow`              | `Gtk.Window`                     | none                   | default content, `role="titlebar"` | `@destroy` is component lifetime, not a GTK signal             |
| `VApplicationWindow`   | `Gtk.ApplicationWindow`          | none                   | default content, `role="titlebar"` | one shared `Gtk.Application` per application id                |
| `VAssistant`           | `Gtk.Assistant`                  | `v-model:current-page` | children are `VAssistantPage`      | deprecated upstream since 4.10                                 |
| `VAssistantPage`       | `Gtk.Box` page wrapper           | none                   | default page content               | one page per child, page metadata via props                    |
| `VDialog`              | `Gtk.Dialog`                     | `v-model:visible`      | `#content` (default)               | action buttons only through the `buttons` prop                 |
| `VMessageDialog`       | `Gtk.MessageDialog`              | none                   | none                               | stock button labels are English; deprecated upstream           |
| `VFileChooserDialog`   | `Gtk.FileChooserDialog`          | none                   | none                               | `current-name` is applied only for `save`; deprecated upstream |
| `VFileChooserNative`   | `Gtk.FileChooserNative`          | none                   | none (controller)                  | not a widget; `show()`/`hide()`/`native`                       |
| `VColorChooserDialog`  | `Gtk.ColorChooserDialog`         | none                   | none                               | deprecated upstream; use `VColorDialog`                        |
| `VFontChooserDialog`   | `Gtk.FontChooserDialog`          | none                   | none                               | deprecated upstream; use `VFontDialog`                         |
| `VAppChooserDialog`    | `Gtk.AppChooserDialog`           | none                   | none (controller)                  | `content-type`/`gfile` are construct-only                      |
| `VPrintUnixDialog`     | `Gtk.PrintUnixDialog`            | none                   | none                               | Unix printing API                                              |
| `VPageSetupUnixDialog` | `Gtk.PageSetupUnixDialog`        | none                   | none                               | Unix printing API                                              |
| `VAboutDialog`         | `Gtk.AboutDialog`                | none                   | none                               | `logo` is an icon name                                         |
| `VAlertDialog`         | `Gtk.AlertDialog` (not a widget) | none                   | none (controller)                  | `choose(parent)` requires a live parent                        |
| `VFileDialog`          | `Gtk.FileDialog` (not a widget)  | none                   | none (controller)                  | parent workaround below; requires a live parent                |
| `VColorDialog`         | `Gtk.ColorDialog` (not a widget) | none                   | none (controller)                  | requires a live parent; resolves `Gdk.RGBA`                    |
| `VFontDialog`          | `Gtk.FontDialog` (not a widget)  | none                   | none (controller)                  | requires a live parent; font readback may be empty (below)     |
| `VShortcutsWindow`     | `Gtk.ShortcutsWindow`            | none                   | `VShortcutsSection` children       | sections are append-only                                       |
| `VShortcutsSection`    | `Gtk.ShortcutsSection`           | none                   | `VShortcutsGroup` children         | groups are append-only                                         |
| `VShortcutsGroup`      | `Gtk.ShortcutsGroup`             | none                   | `VShortcutsShortcut` children      | shortcuts are append-only                                      |
| `VShortcutsShortcut`   | `Gtk.ShortcutsShortcut`          | none                   | none                               | one native shortcut row; no `Gtk.Shortcut` resource            |

`VDialog` also exports `DialogButton` and `ResponseId`; `VFileDialog` and
`VFileChooserDialog`/`VFileChooserNative` accept `FileFilterInput` — either a real
`Gtk.FileFilter` or `{ name, mimeTypes?, patterns? }`. `toFileFilters()` is exported for custom
code.

## Response ids

`ResponseId = number | string`. Stock GTK dialogs emit their numeric `Gtk.ResponseType`
(`OK` = `-5`, `CANCEL` = `-6`, `ACCEPT` = `-3`, …). `VDialog` assigns an internal numeric code to
every declarative button and translates it back:

```vue
<VDialog
  v-model:visible="open"
  :buttons="[
    { id: 'ok', label: 'OK', default: true, suggested: true },
    { id: 'cancel', label: 'Cancel' },
  ]"
  @response="(id) => (answer = id)"
/>
```

`id` may be a string or a number; the handler receives exactly the declared value. The exposed
handle has `button(id)` and `buttons` (a `Map<ResponseId, { code, button }>`), useful for tests or
imperative work. A `default` button gets GTK's `default` CSS class; `suggested` adds
`suggested-action`.

`VMessageDialog` and the chooser dialogs pass the native numeric response through `@response`.
GTK 4.24 has no `close-response` signal, so `VMessageDialog` synthesizes `@close-response` when
`@response` reports `Gtk.ResponseType.CLOSE` or `DELETE_EVENT`. Other dialogs report the close as
the native response id only.

## Windows

```vue
<VWindow
  title="vio"
  :default-width="440"
  :default-height="300"
  :visible="true"
  @close-request="close"
>
  <VBox>…</VBox>
</VWindow>
```

`VWindow` keeps the original single-content slot and `role="titlebar"`. The explicit props are
`title`, `default-width`, `default-height`, `modal`, `resizable`, `decorated`, `transient-for` and
`destroy-with-parent`; all other attributes still pass through to `Gtk.Window`.

`transient-for` accepts a native `Gtk.Window` or a component handle (`{ widget }`), so
`:transient-for="parentRef"` works once the parent ref is populated. Because the ref is not a deep
reactive value, guard it with `v-if` if the parent is a sibling that mounts later.

### `@close-request`

GTK's native contract is `true` = keep the window open. Wave 3 additionally treats an explicit
`false` as cancel (the Vue `preventDefault` convention that the wave 3 brief requested). A handler
that returns nothing / `undefined` lets the default close proceed. The component always returns a
boolean, so a handler that forgets to return a value no longer throws
`Cannot convert value "undefined" to type gboolean`.

### `@destroy`

GTK 4.24's `Gtk.Widget::destroy` signal is declared `when=cleanup` with `no-hooks=1`; it cannot be
connected from user code (verified: `window.on("destroy", …)` never fires). `VWindow` therefore
emits `@destroy` from the component lifetime — on unmount — and from the exposed
`destroy()` method. Destroying the raw `.widget` directly cannot be observed.

Unmount destroys the `Gtk.Window` itself (the renderer's `dispose` path), so no toplevels are left
behind. A visible window is destroyed before its titlebar slot is cleared, avoiding the GTK
`setTitlebar()` warning.

## Applications

`VApplicationWindow` creates or reuses a `Gtk.Application` (`application-id` prop), registers it,
and attaches the window after `Gio.Application::startup`. It emits `@activate` when the application
activates, `@quit` from the exposed `quit()`, and `@shutdown` from `GApplication::shutdown`.
`application` may be an existing `Gtk.Application`; otherwise one application is shared per
`application-id` in the process. The default flags are `Gio.ApplicationFlags.NON_UNIQUE` to avoid
single-instance D-Bus conflicts in tests and multi-window demos.

## Assistants

```vue
<VAssistant v-model:current-page="page">
  <VAssistantPage title="Intro" page-type="intro" :complete="true">…</VAssistantPage>
  <VAssistantPage title="Confirm" page-type="confirm">…</VAssistantPage>
</VAssistant>
```

Pages are role children (`role="page"`); `VAssistantPage` applies `title`, `page-type`, `complete`
and the `current-page` model. `@prepare`, `@apply` and `@close` forward the page widget. GTK 4.24
does not expose a usable `current-page` property notification, so the model is updated from the
`prepare` signal, which fires after the current index changed. Removing a page removes it from the
assistant but leaves it parented to GTK's internal `GtkStack` until the subtree is collected; the
page no longer appears in `getNthPage()`.

`Gtk.Assistant` is deprecated since GTK 4.10 (removal planned for GTK 5). The wrapper exists for
existing wizard layouts; new code should use a `VStack`/`VNotebook` flow.

## Dialogs

`VDialog` places its default/`#content` slot in `Gtk.Dialog`'s content area and adds declarative
buttons. `v-model:visible` presents/hides the dialog; a response also hides it and updates the
model. `default-response` accepts the same string/number id as `buttons`.

`VFileChooserDialog` adds Cancel/Accept buttons itself (GTK 4.24 no longer has a public
`set_accept_label` method for `Gtk.FileChooserDialog`). `current-name` is written only for the
`save` action because GTK asserts when it is set on an `open` dialog. Filters are replaced
wholesale when the `filters` prop changes.

`VFileChooserNative` is a `Gtk.NativeDialog` GObject, **not** a widget, so it renders nothing and
exposes `native`, `show(parent?)`, `hide()` and `destroy()`. `@response` forwards the native
response id.

`VColorChooserDialog`, `VFontChooserDialog` and `VAppChooserDialog` add their own
Cancel/Select action area where GTK does not. `VAppChooserDialog` owns its `Gtk.AppChooserDialog`
because `content-type` and `gfile` are construct-only; changing those props after mount is not
applied (recreate the component with a key to start a new native dialog).

`VAboutDialog` maps `authors`, `artists`, `documenters`, `comments`, `copyright`, `license-type`
(string names such as `mit-x11` or a `Gtk.License` value), `version`, `website`,
`website-label`, `logo` (icon name → `logo-icon-name`) and `program-name`. Strings in `authors`
etc. are passed as `strv`. `@activate-link` is wrapped so a handler that returns nothing is
coerced to `false` instead of throwing.

## Async dialogs and cancellation

`VAlertDialog`, `VFileDialog`, `VColorDialog` and `VFontDialog` are null-rendering controllers.
They must be given a **live parent window**; passing `null`, a non-window value or a destroyed
window throws synchronously:

```text
vio: VAlertDialog.choose() requires a Gtk.Window parent
vio: VAlertDialog.choose() parent window has been destroyed
```

A live parent is detected with `Gtk.Window.listToplevels()`, which includes unrealized windows and
drops destroyed ones.

```vue
<VAlertDialog
  ref="alert"
  message="Delete the file?"
  detail="This cannot be undone."
  :buttons="['Cancel', 'Delete']"
  :cancel-button="0"
  :default-button="1"
/>

<script setup>
async function ask() {
  const answer = await alert.value.choose(windowRef.value);
  if (answer === null) return; // cancelled
  if (answer === 1) deleteFile();
}
</script>
```

| Component      | Method                           | Resolves to                       |
| -------------- | -------------------------------- | --------------------------------- |
| `VAlertDialog` | `choose(parent)`, `show(parent)` | button index (`number`) or `null` |
| `VFileDialog`  | `open(parent)`, `save(parent)`   | `Gio.File` or `null`              |
| `VColorDialog` | `chooseRgba(parent, initial?)`   | `Gdk.RGBA` or `null`              |
| `VFontDialog`  | `chooseFont(parent, initial?)`   | `Pango.FontDescription` or `null` |

Each controller also exposes `open()` aliases where sensible (`VColorDialog.open`,
`VFontDialog.open`), `cancel()` and a `pending` flag.

- One operation per controller: a second call while the first is pending throws
  `vio: … is already pending; await it or call cancel() before starting a new one`.
- `cancel()` immediately resolves the Promise with `null` and cancels the `Gio.Cancellable`; the
  late native callback is ignored. Unmount does the same, so no Promise hangs and cancellation is
  never an unhandled rejection.
- A real (non-cancellation) error is emitted as `@error` and rejects the Promise. Cancellation is
  detected from the `Gio.Cancellable` flag or a `cancel|dismiss` message, because node-gtk turns
  the `GError` into a plain `Error` without its domain/code.
- The parent must already be presented for `VFileDialog` to have a real transient relationship.
  GTK 4.24.1/X11 nevertheless aborts (`SIGSEGV`) when `gtk_file_dialog_open()` receives a
  **realized** parent and the operation is cancelled immediately. `VFileDialog` therefore validates
  the parent but passes it to GTK only while it is unrealized; a realized parent makes the native
  dialog unparented. This is a verified GTK defect, not a vio limitation, and the workaround is
  covered by a child-process test with immediate and delayed cancellation. Color, font and alert
  dialogs use the parent normally.
- Success paths and the portal split are covered in [Async dialogs](#async-dialogs). In short:
  alert and colour resolve in-process, font depends on GTK's font list, and a portal-backed file
  dialog has no in-process widget to accept.

## Deprecated upstream and replacements

| Deprecated (since GTK 4.10) | vio wrapper           | Replacement                          |
| --------------------------- | --------------------- | ------------------------------------ |
| `Gtk.Dialog`                | `VDialog`             | `Gtk.AlertDialog` / a `Gtk.Window`   |
| `Gtk.MessageDialog`         | `VMessageDialog`      | `Gtk.AlertDialog`                    |
| `Gtk.FileChooserDialog`     | `VFileChooserDialog`  | `Gtk.FileDialog` (`VFileDialog`)     |
| `Gtk.FileChooserNative`     | `VFileChooserNative`  | `Gtk.FileDialog` (`VFileDialog`)     |
| `Gtk.ColorChooserDialog`    | `VColorChooserDialog` | `Gtk.ColorDialog` (`VColorDialog`)   |
| `Gtk.FontChooserDialog`     | `VFontChooserDialog`  | `Gtk.FontDialog` (`VFontDialog`)     |
| `Gtk.AppChooserDialog`      | `VAppChooserDialog`   | no GTK4 replacement; keep for legacy |
| `Gtk.Assistant`             | `VAssistant`          | `Gtk.Stack` / `Gtk.Notebook` flow    |

The wrappers stay functional on 4.24 and are documented as compatibility surfaces. New code
should prefer the non-deprecated controller components.

## Shortcuts window

The earlier conclusion that the shortcuts tree is internal was incorrect. Verified on GTK 4.24.1
with GObject Introspection and construction:

```bash
$ node --import @zede/vio/register --input-type=module -e 'import Gtk from "gi:Gtk-4.0"; import GObject from "gi:GObject-2.0"; import {getGType} from "node-gtk"; for (const n of ["ShortcutsSection","ShortcutsGroup","ShortcutsShortcut"]) { const t=getGType(Gtk[n]); console.log(GObject.typeName(t), "parent="+GObject.typeName(GObject.typeParent(t))); }'
GtkShortcutsSection parent=GtkBox
GtkShortcutsGroup parent=GtkBox
GtkShortcutsShortcut parent=GtkWidget
```

All three are public constructible widgets with introspected properties. Placement uses the
public methods:

| Component            | Native                  | Placement                                                                                     |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `VShortcutsWindow`   | `Gtk.ShortcutsWindow`   | `addSection()`, sections are `VShortcutsSection` children                                     |
| `VShortcutsSection`  | `Gtk.ShortcutsSection`  | `addGroup()`, groups are `VShortcutsGroup` children                                           |
| `VShortcutsGroup`    | `Gtk.ShortcutsGroup`    | `addShortcut()`, rows are `VShortcutsShortcut` children                                       |
| `VShortcutsShortcut` | `Gtk.ShortcutsShortcut` | leaf; `title`, `subtitle`, `accelerator`, `icon`, `action-name`, `direction`, `shortcut-type` |

```vue
<VShortcutsWindow title="Shortcuts" :visible="showShortcuts" @close-request="closeShortcuts">
  <VShortcutsSection title="Editing" section-name="editing">
    <VShortcutsGroup title="Files">
      <VShortcutsShortcut title="Open" accelerator="&lt;Control&gt;o" />
      <VShortcutsShortcut title="Save" accelerator="&lt;Control&gt;s" />
    </VShortcutsGroup>
  </VShortcutsSection>
</VShortcutsWindow>
```

The components keep the element ref and `.widget`, like the other containers. All three `add*`
methods append, so keyed reordering is not implemented: recreate the subtree or manipulate the raw
`.widget` when a different order is required. `Gtk.Shortcut` is a non-widget `GObject` and stays an
imperative resource for action accelerators; `VShortcutsShortcut` is the visual row only.

## Async dialogs

`VAlertDialog`, `VColorDialog` and `VFontDialog` present in-process GTK dialogs, so their success
paths are testable without a portal:

- **`VAlertDialog`** resolves the button index after the internal `Gtk.Dialog` response is
  activated, and still supports `cancel()`, a repeated `choose()` and unmount cancellation.
- **`VColorDialog`** resolves a `Gdk.RGBA` and emits `@color`. On this theme the internal colour
  sliders log `GtkGizmo … reported min width -2`; the test installs
  `slider { min-width: 16px; min-height: 16px; }` through `installCss()`. The library does not
  install that rule globally. A second `chooseRgba()` still cancels to `null`.
- **`VFontDialog`** presents `GtkFontChooserDialog`, but this host's GTK renders `No Fonts Found`
  (2378 `fc-list` entries exist), `getFont()` stays `null`, and the Select button is insensitive.
  The dialog therefore settles through cancellation (`null`) instead of rejecting, and the test
  switches to a `Pango.FontDescription` assertion when GTK lists fonts. This is the same
  `GtkFontChooserWidget` readback defect documented in [`small.md`](small.md).

**`VFileDialog` and the portal.** On this machine the portal is present:

```bash
$ echo "$DBUS_SESSION_BUS_ADDRESS"
unix:path=/run/user/1000/bus
$ busctl --user list | grep -E 'org\.freedesktop\.portal\.Desktop |org\.freedesktop\.impl\.portal\.desktop\.gtk '
org.freedesktop.impl.portal.desktop.gtk  1458 ... :1.62 ...
org.freedesktop.portal.Desktop           1367 ... :1.50 ...
$ gdbus call --session --dest org.freedesktop.portal.Desktop \
    --object-path /org/freedesktop/portal/desktop \
    --method org.freedesktop.DBus.Properties.Get \
    org.freedesktop.portal.FileChooser version
(<uint32 4>,)
```

`dbus-monitor` during `Gtk.FileDialog.open()` shows
`org.freedesktop.portal.FileChooser.OpenFile`. The local `GtkFileChooserDialog` object stays
unrealized (`getVisible() === false`) while the visible chooser belongs to
`org.freedesktop.impl.portal.desktop.gtk` in another process. There is no in-process button to
activate, so a success test would require scripting the remote portal UI; the test suite covers
the realized-parent SIGSEGV workaround, immediate and delayed cancellation, and the portal request
itself.

## What is not expressible

- Nested main loops or a blocking `run()` on a dialog. Async dialogs return Promises; tests and
  applications drive the existing GLib loop.
- A scripted success response from the desktop portal. `Gtk.FileDialog` delegates presentation to
  `org.freedesktop.impl.portal.desktop.*`; vio can only cancel the request.
- `GtkBuildable` XML.
- Keyed reordering of `Gtk.Shortcuts*` sections, groups or shortcuts: the public API is append-only.
- Parent-dependent async calls without a live `Gtk.Window`.
- Changing construct-only `Gtk.AppChooserDialog` properties after construction.
- Observing a raw `Gtk.Widget.destroy` signal on GTK 4.24.
