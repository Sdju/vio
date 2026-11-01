# Media, canvas and value components (wave 4)

`packages/vio/src/modules/gtk/media.ts` adds the media, canvas and value-picker widgets, plus the
list-model and selection helpers that were still assembled by hand after wave 2. Components stay
thin wrappers over GTK; every native object is reachable through a component ref.

```bash
vp run --filter @zede/vio demo:media   # picture, cairo canvas, GL area, pickers, calendar, models
```

## Components

| Component            | GTK widget                   | `v-model`                        | Slots | Limitations                                                           |
| -------------------- | ---------------------------- | -------------------------------- | ----- | --------------------------------------------------------------------- |
| `VPicture`           | `Gtk.Picture`                | none                             | none  | local filenames only; `paintable` and `file`/`filename` are exclusive |
| `VMediaFile`         | none (`Gtk.MediaFile`)       | `v-model:playing` (`boolean`)    | none  | missing files stay an empty state and are never given to GStreamer    |
| `VVideo`             | `Gtk.Video`                  | none                             | none  | no decoder means an empty video; `autoplay`/`loop` still apply        |
| `VMediaControls`     | `Gtk.MediaControls`          | `v-model:playing` (`boolean`)    | none  | `playing` is derived from the media stream, not a GTK property        |
| `VDrawingArea`       | `Gtk.DrawingArea`            | none                             | none  | cairo draw runs only after the widget is allocated                    |
| `VGLArea`            | `Gtk.GLArea`                 | none                             | none  | a missing GL context is reported through the handle and `@render`     |
| `VColorButton`       | `Gtk.ColorButton`            | `v-model:rgba` (`Gdk.RGBA`)      | none  | the model value is a native `Gdk.RGBA` instance                       |
| `VFontButton`        | `Gtk.FontButton`             | `v-model:font` (`string`)        | none  | accepts a `Pango.FontDescription` on input, emits a string            |
| `VColorDialogButton` | `Gtk.ColorDialogButton`      | `v-model:rgba` (`Gdk.RGBA`)      | none  | `@color-set` is synthesized from `notify::rgba`                       |
| `VFontDialogButton`  | `Gtk.FontDialogButton`       | `v-model:font` (`string`)        | none  | `@font-set` is synthesized from `notify::font-desc`                   |
| `VCalendar`          | `Gtk.Calendar`               | `v-model:date` (`GLib.DateTime`) | none  | `month` on the handle is 1-based; the native getter stays 0-based     |
| `VStringList`        | none (`Gtk.StringList`)      | none                             | none  | string items only; exposes `stringList`                               |
| `VFilterListModel`   | none (`Gtk.FilterListModel`) | none                             | none  | `autoexpand` is accepted but has no effect on GTK 4.24                |
| `VSortListModel`     | none (`Gtk.SortListModel`)   | none                             | none  | uses a JS `Gtk.Sorter` subclass instead of `Gtk.CustomSorter`         |

`VMediaFile`, `VStringList`, `VFilterListModel` and `VSortListModel` are null-rendering resources:
they expose native objects to a component ref and place nothing in the GTK tree.

## Pictures

```vue
<VPicture
  filename="/tmp/photo.png"
  content-fit="cover"
  :can-shrink="false"
  alternative-text="photo"
/>
```

`paintable` takes a `Gdk.Paintable`/`Gdk.Texture` directly. `file` (a `Gio.File` or a path) and
`filename` are a convenience: the component calls `Gdk.Texture.newFromFilename()` and never hands a
missing path to GTK, so a broken path leaves an empty picture instead of a warning. `content-fit` is
one of `fill`, `contain`, `cover`, `scale-down`.

## Media streams

```vue
<VMediaFile ref="media" filename="/tmp/song.ogg" v-model:playing="playing" @ended="next" />
<VVideo :media-stream="media" autoplay loop />
<VMediaControls :media-stream="media" v-model:playing="playing" />
```

- `VVideo` accepts `file`, `filename` or `media-stream`. A `VMediaFile` component ref, a raw
  `Gtk.MediaStream`/`Gtk.MediaFile`, or a handle with `.mediaStream`/`.mediaFile` are all accepted.
- `VMediaFile` exposes `mediaFile`, `available`, `playing`, `ended`, `duration` (microseconds),
  `timestamp` (microseconds), `error`, `play()`, `pause()` and `seek()`.
- A nonexistent path is an empty state: the component sets `error`, `available = false`, and never
  calls `play()`. This matters because `GtkMediaFile` on a missing file reaches
  `gtk_gst_media_file_source_setup_cb` and logs a `Gtk-CRITICAL` (verified on 4.24.1) if played.
- The GTK `GtkMediaStream` interface signals `playing-changed`/`ended` cannot be connected by name
  through node-gtk 4.1.1 (`Signal name is invalid`). The components bridge the equivalent object
  notifications `notify::playing`, `notify::ended`, `notify::duration` and `notify::timestamp`
  instead. The public Vue events keep GTK's names: `@playing-changed`, `@ended`, `@playing`.
- `Gtk.MediaControls` has no `playing` property on GTK 4.24. `v-model:playing` reads the attached
  stream's `playing` property and writes it with `play()`/`pause()`.
- GStreamer is not imported or initialized by the library. A machine without decoders still mounts
  these widgets; playback stays empty and GStreamer may print its own warnings.

## Canvas

```vue
<VDrawingArea
  :draw="
    (area, context, width, height) => {
      context.setSourceRgb(0.2, 0.6, 0.3);
      context.rectangle(0, 0, width, height);
      context.fill();
    }
  "
  :content-width="320"
  :content-height="180"
/>
```

- cairo **is** supported through node-gtk 4.1.1: `gi:cairo` loads and `setDrawFunc()` receives a
  `CairoContext`. cairo method names are camelCase (`setSourceRgb`, `setSourceRgba`,
  `createLinearGradient`, `writeToPng`), not snake_case.
- The callback signature matches GTK: `(area, cairoContext, width, height)`. `@draw` is accepted as
  an alternative to the `draw` prop; both are removed from the native signal table so they are not
  mistaken for a GTK `draw` signal.
- An exception thrown by the draw callback would otherwise abort the process inside a C callback.
  `VDrawingArea` catches it and emits `@error`; the frame is simply left partially drawn.
- The draw function runs only after GTK allocates the area. In this repository's X session a window
  reports `0x0` until the display loop has run at least one delayed iteration (`setTimeout` plus
  `GLib.MainContext.iteration()`), so the draw test presents a real window in a child process.

`VGLArea` exposes `has-depth-buffer`, `has-stencil-buffer`, `use-es` and `auto-render`. On the
current X11 display a real GL context is created (`GdkX11GLContextEGL`) and `@render` is called once
the window is allocated, but the suite follows the wave-4 rule and tests only the properties: GL
tests stay desktop-only. The component never crashes when no context appears; `@render` receives
`null` (and the handle exposes `context = null`, `api`, `error`). Returning `true` from a native
`@render` handler keeps GTK from clearing the framebuffer; the observer in the component always
returns `false` so the caller's return value decides.

## Value pickers and calendar

- `rgba` accepts a `Gdk.RGBA`, a CSS color string (`#rrggbb`, `rgb(...)`) or `{ r, g, b, a }` /
  `{ red, green, blue, alpha }`. `v-model:rgba` emits the native `Gdk.RGBA`; keep it in a
  `shallowRef`, because a deep `ref()` proxies the boxed object.
- `font` accepts a string or `Pango.FontDescription`. The model value is always the string returned
  by `Gtk.FontButton:font` / `Gtk.FontDialogButton:font-desc`.
- `dialog` on the dialog buttons accepts a `VColorDialog`/`VFontDialog` component ref (its `.dialog`),
  or a raw `Gtk.ColorDialog`/`Gtk.FontDialog`.
- `Gtk.ColorDialogButton` and `Gtk.FontDialogButton` have no `color-set`/`font-set` signals on
  4.24. The components synthesize those Vue events from `notify::rgba` / `notify::font-desc` and
  de-duplicate consecutive notifications, so setting the prop does not echo back.
- `date` accepts a `GLib.DateTime`, a JS `Date`, an ISO `YYYY-MM-DD` string or
  `{ year, month, day }` with a **1-based** month. `v-model:date` emits `GLib.DateTime`; the
  handle exposes read-only `day`, `month` (1-based) and `year`. `@day-selected`, `@next-month` and
  `@prev-month` are forwarded from GTK.

## List models and selections

```ts
import { useFilterListModel, useSingleSelection, useStringList } from "@zede/vio";

const names = useStringList(() => props.items);
const filter = useFilterListModel(names, (item) => item.getString().includes(query));
const selection = useSingleSelection(filter.filterListModel);
```

| Helper                                 | Native object                              | Notes                                                           |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `toStringList(items)`                  | `Gtk.StringList`                           | one-shot constructor                                            |
| `useStringList(getItems)`              | `Gtk.StringList`                           | `watch` + `splice()`, deep on the source array                  |
| `useFilterListModel(model, predicate)` | `Gtk.FilterListModel` + `Gtk.CustomFilter` | `setPredicate()` refilters; boolean callbacks marshal correctly |
| `useSortListModel(model, compare)`     | `Gtk.SortListModel` + `Gtk.Sorter`         | see the `CustomSorter` deviation below                          |
| `useSingleSelection(model)`            | `Gtk.SingleSelection`                      | starts with `selected = -1`; `selected`, `selectedItem`         |
| `useMultiSelection(model)`             | `Gtk.MultiSelection`                       | `selected: number[]`; `select`, `unselect`, `selectAll`         |
| `useNoSelection(model)`                | `Gtk.NoSelection`                          | `selected` is always `-1`                                       |

The models accept a direct `Gio.ListModel` or a getter (`() => model`) and are released on scope
dispose. `VStringList`, `VFilterListModel` and `VSortListModel` are the declarative form of the same
resources; chain them with template refs.

`VColumnView`/`VGridView` already wrap a model in their own selection from `selection-mode`. The
selection helpers return a selection that can be passed to a raw `Gtk.ListView`, or its `selected`
position can be bound to the view's `:selected`; both wrap the same model, so positions agree.

### `Gtk.CustomSorter` is not usable in node-gtk 4.1.1

`GtkCustomSorterFunc` takes `gconstpointer` arguments. node-gtk 4.1.1 passes `undefined` for all
three callback arguments (verified with `Gtk.CustomSorter.new((a, b) => …)`: the callback receives
`arguments.length === 3` and every argument is `undefined`). A `Gtk.CustomFilterFunc` receives its
item and its boolean return is marshalled, so filtering uses `Gtk.CustomFilter` as designed.

`useSortListModel()` therefore registers one JS `Gtk.Sorter` subclass (`virtual_compare`) and feeds
it to `Gtk.SortListModel`. The comparator is ordinary JavaScript (`< 0`, `> 0`, `0`). This is a
documented deviation from the wave-4 brief, not a silent fallback: the test asserts that the sorter
is a `Gtk.Sorter` and explicitly not a `Gtk.CustomSorter`.

### `autoexpand`

`VFilterListModel` accepts `autoexpand`, but `Gtk.FilterListModel` on GTK 4.24 has no such property
(it was a `GtkTreeModelFilter` concept in GTK 3). The prop is a no-op and is documented here rather
than forwarded into `setProperty()`, which would throw.

## Tests

`packages/vio/tests/media.test.mjs` covers 16 cases: picture/texture and missing files, media state
and notifications, empty video/controls, a real cairo draw in a child process, GL properties, all
five pickers, the calendar, the three model resources, the selection helpers and a mount/unmount
warning check. GStreamer is initialized only in this suite; the assertions do not require working
codecs. The draw and presentation checks run in child processes so no nested main loop is created.
