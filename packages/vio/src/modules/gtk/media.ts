import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import Pango from "gi:Pango-1.0";
import { registerClass } from "node-gtk";
import {
  defineComponent,
  h,
  markRaw,
  onMounted,
  onScopeDispose,
  onUnmounted,
  shallowRef,
  watch,
  type PropType,
  type Ref,
} from "@vue/runtime-core";
import type Cairo from "gi:cairo";
import type { VioElement } from "../renderer/index.ts";
import { requireGtkVersion } from "./gtk-version.ts";

type Attrs = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;
type NativeFile = NonNullable<Parameters<typeof Gtk.MediaFile.newForFile>[0]>;
type ListModel = NonNullable<Parameters<typeof Gtk.FilterListModel.new>[0]>;
type MediaStream = InstanceType<typeof Gtk.MediaStream>;
type MediaFile = InstanceType<typeof Gtk.MediaFile>;
type SelectionModel =
  | InstanceType<typeof Gtk.SingleSelection>
  | InstanceType<typeof Gtk.MultiSelection>
  | InstanceType<typeof Gtk.NoSelection>;

/** Cairo draw function, matching `Gtk.DrawingArea.setDrawFunc()` argument order. */
export type DrawingAreaDraw = (
  area: InstanceType<typeof Gtk.DrawingArea>,
  context: InstanceType<typeof Cairo.Context>,
  width: number,
  height: number,
) => void;

/** A `Gdk.RGBA`, a CSS color string, or an object with r/g/b/a (or red/green/blue/alpha). */
export type RgbaInput =
  | InstanceType<typeof Gdk.RGBA>
  | string
  | {
      r?: number;
      g?: number;
      b?: number;
      a?: number;
      red?: number;
      green?: number;
      blue?: number;
      alpha?: number;
    }
  | null;

/** A Pango font description or its serialized `"Family Style Size"` form. */
export type FontInput = string | InstanceType<typeof Pango.FontDescription> | null;

/** A `GLib.DateTime`, a JS `Date`, an ISO date string, or 1-based `{ year, month, day }`. */
export type DateInput =
  | InstanceType<typeof GLib.DateTime>
  | Date
  | string
  | { year: number; month: number; day: number }
  | null;

type MaybeGetter<T> = T | (() => T);

const isGetter = <T>(value: MaybeGetter<T>): value is () => T => typeof value === "function";

function read<T>(value: MaybeGetter<T>): T {
  return isGetter(value) ? value() : value;
}

function useElement() {
  const element = shallowRef<VioElement | null>(null);
  const handle = {
    element,
    get widget() {
      return element.value?.widget ?? null;
    },
  };
  return { element, handle };
}

function callbacks(value: unknown): Handler[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as Handler[]) : [value as Handler];
}

/** Keep the caller's signal handler and append the component's model handler. */
function withHandler(attrs: Attrs, key: string, handler: Handler) {
  const rest = { ...attrs };
  const user = rest[key];
  delete rest[key];
  return { attrs: rest, handlers: [handler, ...callbacks(user)] as Handler[] };
}

/* ------------------------------------------------------------------------------------------------
 * Value conversions shared by the pickers and media props.
 * ---------------------------------------------------------------------------------------------- */

function fileFrom(value: unknown): NativeFile | null {
  if (value == null) return null;
  if (typeof value === "string")
    return value.includes("://") ? Gio.File.newForUri(value) : Gio.File.newForPath(value);
  const candidate = value as { getPath?: unknown; getUri?: unknown };
  if (typeof candidate.getPath === "function" && typeof candidate.getUri === "function")
    return value as NativeFile;
  return null;
}

function fileExists(file: NativeFile): boolean {
  try {
    return file.queryExists(null);
  } catch {
    return false;
  }
}

function pathOf(file: NativeFile): string {
  try {
    return file.getPath() ?? file.getUri();
  } catch {
    return "unknown location";
  }
}

/** `file` / `filename` prop → texture, or `null` when the file is missing or unreadable. */
function textureFrom(value: unknown): InstanceType<typeof Gdk.Texture> | null {
  if (value == null) return null;
  const path =
    typeof value === "string"
      ? value
      : (() => {
          const file = fileFrom(value);
          return file ? pathOf(file) : null;
        })();
  if (!path) return null;
  const file = fileFrom(value);
  if (file && !fileExists(file)) return null;
  try {
    return Gdk.Texture.newFromFilename(path);
  } catch {
    return null;
  }
}

function toRgba(value: RgbaInput): InstanceType<typeof Gdk.RGBA> | null {
  if (value == null) return null;
  if (value instanceof Gdk.RGBA) return value;
  const rgba = new Gdk.RGBA();
  if (typeof value === "string") {
    if (!rgba.parse(value)) throw new Error(`vio: invalid rgba string '${value}'`);
    return rgba;
  }
  const source = value as {
    r?: number;
    g?: number;
    b?: number;
    a?: number;
    red?: number;
    green?: number;
    blue?: number;
    alpha?: number;
  };
  const red = source.r ?? source.red;
  const green = source.g ?? source.green;
  const blue = source.b ?? source.blue;
  if (red === undefined || green === undefined || blue === undefined)
    throw new Error("vio: rgba objects need r/g/b (or red/green/blue) numbers");
  rgba.red = red;
  rgba.green = green;
  rgba.blue = blue;
  rgba.alpha = source.a ?? source.alpha ?? 1;
  return rgba;
}

function sameRgba(
  a: InstanceType<typeof Gdk.RGBA> | null,
  b: InstanceType<typeof Gdk.RGBA> | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.red === b.red && a.green === b.green && a.blue === b.blue && a.alpha === b.alpha;
}

function toFontDescription(value: FontInput): InstanceType<typeof Pango.FontDescription> | null {
  if (value == null) return null;
  if (value instanceof Pango.FontDescription) return value;
  if (typeof value !== "string")
    throw new Error("vio: font must be a string or Pango.FontDescription");
  return Pango.FontDescription.fromString(value);
}

function toDateTime(value: DateInput): InstanceType<typeof GLib.DateTime> | null {
  if (value == null) return null;
  if (value instanceof GLib.DateTime) return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("vio: invalid Date for calendar");
    return GLib.DateTime.newLocal(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
  }
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) throw new Error(`vio: invalid calendar date '${value}'; use YYYY-MM-DD`);
    return GLib.DateTime.newLocal(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0);
  }
  if (typeof value === "object") {
    const date = value as { year: number; month: number; day: number };
    if (![date.year, date.month, date.day].every((part) => Number.isFinite(part)))
      throw new Error("vio: calendar date objects need numeric year, month and day");
    return GLib.DateTime.newLocal(date.year, date.month, date.day, 0, 0, 0);
  }
  throw new Error("vio: unsupported calendar date value");
}

function dateKey(value: InstanceType<typeof GLib.DateTime> | null): string {
  return value?.format("%Y-%m-%d %H:%M:%S") ?? "";
}

/** A `VMediaFile` handle, a raw `Gtk.MediaStream`, or nothing. */
function mediaStreamFrom(value: unknown): MediaStream | null {
  if (value == null) return null;
  const candidate =
    (value as { mediaStream?: unknown }).mediaStream ??
    (value as { mediaFile?: unknown }).mediaFile ??
    value;
  const stream = candidate as MediaStream;
  return typeof stream?.getPlaying === "function" ? stream : null;
}

function nativeDialog<T extends object>(
  value: unknown,
  ctor: new (...args: never[]) => T,
): T | null {
  if (value == null) return null;
  const candidate = (value as { dialog?: unknown }).dialog ?? value;
  return candidate instanceof ctor ? candidate : null;
}

const contentFits: Record<string, number> = {
  fill: Gtk.ContentFit.FILL,
  contain: Gtk.ContentFit.CONTAIN,
  cover: Gtk.ContentFit.COVER,
  "scale-down": Gtk.ContentFit.SCALE_DOWN,
};

function contentFitOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const fit = contentFits[value];
  if (fit === undefined) throw new Error(`vio: unknown content-fit '${value}'`);
  return fit;
}

/* ------------------------------------------------------------------------------------------------
 * Pictures.
 * ---------------------------------------------------------------------------------------------- */

export const VPicture = defineComponent({
  name: "VPicture",
  inheritAttrs: false,
  props: {
    paintable: { type: Object as PropType<object | null>, default: null },
    file: { type: [Object, String] as PropType<NativeFile | string | null>, default: null },
    filename: { type: String as PropType<string | undefined>, default: undefined },
    contentFit: { type: String as PropType<string | undefined>, default: undefined },
    canShrink: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    alternativeText: { type: String as PropType<string | undefined>, default: undefined },
    keepAspectRatio: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    if (props.paintable != null && (props.file != null || props.filename !== undefined))
      throw new Error("vio: VPicture accepts either 'paintable' or 'file'/'filename', not both");
    const { element, handle } = useElement();
    expose(handle);
    return () => {
      const fit = contentFitOf(props.contentFit);
      const source = props.filename ?? props.file;
      const paintable = props.paintable ?? textureFrom(source);
      return h("picture", {
        ...attrs,
        ref: element,
        ...(paintable == null ? {} : { paintable }),
        ...(fit === undefined ? {} : { contentFit: fit }),
        ...(props.canShrink === undefined ? {} : { canShrink: props.canShrink }),
        ...(props.alternativeText === undefined ? {} : { alternativeText: props.alternativeText }),
        ...(props.keepAspectRatio === undefined ? {} : { keepAspectRatio: props.keepAspectRatio }),
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Media streams.
 * ---------------------------------------------------------------------------------------------- */

export const VMediaFile = defineComponent({
  name: "VMediaFile",
  props: {
    file: { type: [Object, String] as PropType<NativeFile | string | null>, default: null },
    filename: { type: String as PropType<string | undefined>, default: undefined },
    playing: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    loop: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:playing", "playing-changed", "ended", "error"],
  setup(props, { expose, emit }) {
    const mediaFile = shallowRef<MediaFile | null>(null);
    const available = shallowRef(false);
    const playing = shallowRef(false);
    const ended = shallowRef(false);
    const duration = shallowRef(0);
    const timestamp = shallowRef(0);
    const error = shallowRef<string | null>(null);
    let bound: MediaFile | null = null;
    let disposed = false;

    const readState = () => {
      if (!bound) return;
      const nextPlaying = bound.getPlaying();
      playing.value = nextPlaying;
      ended.value = bound.getEnded();
      duration.value = Number(bound.getDuration());
      timestamp.value = Number(bound.getTimestamp());
      if (props.playing !== undefined && nextPlaying !== props.playing)
        emit("update:playing", nextPlaying);
      emit("playing-changed", nextPlaying);
    };
    const onEnded = () => {
      if (!bound || disposed) return;
      ended.value = bound.getEnded();
      emit("ended");
    };
    const onProgress = () => {
      if (!bound || disposed) return;
      duration.value = Number(bound.getDuration());
      timestamp.value = Number(bound.getTimestamp());
    };
    const onError = () => {
      if (!bound || disposed) return;
      const nativeError = bound.getError() ?? null;
      const message = nativeError?.message ?? "media stream error";
      error.value = message;
      playing.value = bound.getPlaying();
      emit("error", nativeError ?? new Error(message));
    };
    const detach = () => {
      bound?.off("notify::playing", readState);
      bound?.off("notify::ended", onEnded);
      bound?.off("notify::duration", onProgress);
      bound?.off("notify::timestamp", onProgress);
      bound?.off("notify::error", onError);
      bound = null;
    };
    const play = () => {
      if (!bound) return false;
      try {
        bound.play();
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        error.value = message;
        emit("error", cause);
        return false;
      }
    };
    const pause = () => {
      if (!bound) return false;
      try {
        bound.pause();
        return true;
      } catch {
        return false;
      }
    };
    const seek = (position: number) => {
      if (!bound) return false;
      try {
        bound.seek(Math.max(0, Math.round(position)));
        return true;
      } catch {
        return false;
      }
    };
    const sync = () => {
      detach();
      mediaFile.value = null;
      available.value = false;
      playing.value = false;
      ended.value = false;
      duration.value = 0;
      timestamp.value = 0;
      error.value = null;
      const source = props.filename ?? props.file;
      if (source == null) return;
      const file = fileFrom(source);
      if (!file || !fileExists(file)) {
        error.value = `media file not found: ${file ? pathOf(file) : String(source)}`;
        return;
      }
      let created: MediaFile;
      try {
        created = Gtk.MediaFile.newForFile(file);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        emit("error", cause);
        return;
      }
      bound = created;
      mediaFile.value = markRaw(created);
      available.value = true;
      if (props.loop !== undefined) created.setLoop(props.loop);
      created.on("notify::playing", readState);
      created.on("notify::ended", onEnded);
      created.on("notify::duration", onProgress);
      created.on("notify::timestamp", onProgress);
      created.on("notify::error", onError);
      if (props.playing === true) play();
    };
    onMounted(sync);
    watch(() => [props.filename, props.file] as const, sync);
    watch(
      () => props.loop,
      (value) => {
        if (bound && value !== undefined) bound.setLoop(value);
      },
    );
    watch(
      () => props.playing,
      (value) => {
        if (!bound || value === undefined) return;
        if (value === bound.getPlaying()) return;
        if (value) play();
        else pause();
      },
    );
    onUnmounted(() => {
      disposed = true;
      pause();
      detach();
      mediaFile.value = null;
      available.value = false;
    });
    expose({
      mediaFile,
      get mediaStream() {
        return mediaFile.value;
      },
      available,
      playing,
      ended,
      duration,
      timestamp,
      error,
      play,
      pause,
      seek,
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

export const VVideo = defineComponent({
  name: "VVideo",
  inheritAttrs: false,
  props: {
    file: { type: [Object, String] as PropType<NativeFile | string | null>, default: null },
    filename: { type: String as PropType<string | undefined>, default: undefined },
    autoplay: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    loop: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    mediaStream: { type: Object as PropType<MediaStream | object | null>, default: null },
  },
  emits: ["playing", "ended", "error"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const stream = shallowRef<MediaStream | null>(null);
    const playing = shallowRef(false);
    const ended = shallowRef(false);
    const error = shallowRef<string | null>(null);
    let bound: MediaStream | null = null;
    let owned: MediaFile | null = null;
    let disposed = false;

    const onPlaying = () => {
      if (!bound || disposed) return;
      playing.value = bound.getPlaying();
      emit("playing", playing.value);
    };
    const onEnded = () => {
      if (!bound || disposed) return;
      ended.value = true;
      emit("ended");
    };
    const onError = () => {
      if (!bound || disposed) return;
      const nativeError = bound.getError() ?? null;
      const message = nativeError?.message ?? "media stream error";
      error.value = message;
      playing.value = bound.getPlaying();
      emit("error", nativeError ?? new Error(message));
    };
    const detach = () => {
      bound?.off("notify::playing", onPlaying);
      bound?.off("notify::ended", onEnded);
      bound?.off("notify::error", onError);
      bound = null;
    };
    const sync = () => {
      detach();
      if (owned) {
        try {
          owned.pause();
        } catch {
          /* the stream may already be closed */
        }
        owned = null;
      }
      stream.value = null;
      playing.value = false;
      ended.value = false;
      error.value = null;
      let next = mediaStreamFrom(props.mediaStream);
      if (!next) {
        const source = props.filename ?? props.file;
        if (source == null) return;
        const file = fileFrom(source);
        if (!file || !fileExists(file)) {
          error.value = `media file not found: ${file ? pathOf(file) : String(source)}`;
          return;
        }
        try {
          owned = Gtk.MediaFile.newForFile(file);
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          emit("error", cause);
          return;
        }
        if (props.loop !== undefined) owned.setLoop(props.loop);
        next = owned;
      }
      bound = next;
      stream.value = markRaw(next);
      bound.on("notify::playing", onPlaying);
      bound.on("notify::ended", onEnded);
      bound.on("notify::error", onError);
      if (props.autoplay) {
        try {
          bound.play();
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          emit("error", cause);
        }
      }
    };
    onMounted(sync);
    watch(() => [props.filename, props.file, props.mediaStream] as const, sync);
    watch(
      () => props.autoplay,
      (value) => {
        if (!bound || !value) return;
        try {
          bound.play();
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          emit("error", cause);
        }
      },
    );
    onUnmounted(() => {
      disposed = true;
      try {
        owned?.pause();
      } catch {
        /* ignore a stream that never started */
      }
      detach();
      owned = null;
      stream.value = null;
    });
    expose({
      mediaStream: stream,
      get mediaFile() {
        return owned;
      },
      playing,
      ended,
      error,
      get widget() {
        return handle.widget;
      },
    });
    return () =>
      h("video", {
        ...attrs,
        ref: element,
        ...(stream.value == null ? {} : { mediaStream: stream.value }),
        ...(props.autoplay === undefined ? {} : { autoplay: props.autoplay }),
        ...(props.loop === undefined ? {} : { loop: props.loop }),
      });
  },
});

export const VMediaControls = defineComponent({
  name: "VMediaControls",
  inheritAttrs: false,
  props: {
    mediaStream: { type: Object as PropType<MediaStream | object | null>, default: null },
    playing: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:playing"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const stream = shallowRef<MediaStream | null>(null);
    let bound: MediaStream | null = null;
    let applying = false;
    const changed = () => {
      if (!bound || applying) return;
      const next = bound.getPlaying();
      if (props.playing !== undefined && next !== props.playing) emit("update:playing", next);
    };
    const detach = () => {
      bound?.off("notify::playing", changed);
      bound = null;
    };
    const sync = () => {
      detach();
      bound = mediaStreamFrom(props.mediaStream);
      stream.value = bound ? markRaw(bound) : null;
      bound?.on("notify::playing", changed);
    };
    sync();
    watch(() => props.mediaStream, sync);
    watch(
      () => props.playing,
      (value) => {
        if (!bound || value === undefined || value === bound.getPlaying()) return;
        applying = true;
        try {
          if (value) bound.play();
          else bound.pause();
        } catch {
          /* a stream without codecs stays paused; the model is unchanged */
        } finally {
          applying = false;
        }
      },
    );
    onUnmounted(() => {
      detach();
      stream.value = null;
    });
    expose({
      mediaStream: stream,
      get widget() {
        return handle.widget;
      },
    });
    return () =>
      h("media-controls", {
        ...attrs,
        ref: element,
        ...(stream.value == null ? {} : { mediaStream: stream.value }),
      });
  },
});

/* ------------------------------------------------------------------------------------------------
 * Canvas widgets.
 * ---------------------------------------------------------------------------------------------- */

export const VDrawingArea = defineComponent({
  name: "VDrawingArea",
  inheritAttrs: false,
  props: {
    draw: { type: Function as PropType<DrawingAreaDraw | undefined>, default: undefined },
    contentWidth: { type: Number as PropType<number | undefined>, default: undefined },
    contentHeight: { type: Number as PropType<number | undefined>, default: undefined },
  },
  emits: ["error"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const drawHandlers = () => (props.draw ? [props.draw as Handler] : callbacks(attrs.onDraw));
    let installed: Handler[] = [];
    const install = () => {
      const area = element.value?.widget as InstanceType<typeof Gtk.DrawingArea> | undefined;
      if (!area) return;
      const handlers = drawHandlers();
      if (handlers === installed) return;
      installed = handlers;
      if (handlers.length === 0) {
        (area as unknown as { setDrawFunc(value: null): void }).setDrawFunc(null);
        return;
      }
      area.setDrawFunc((widget, context, width, height) => {
        for (const handler of handlers) {
          try {
            handler(widget, context, width, height);
          } catch (cause) {
            // A throw inside a GTK draw callback would abort the process; report it instead.
            emit("error", cause);
          }
        }
      });
    };
    onMounted(install);
    watch(() => [props.draw, attrs.onDraw] as const, install, { flush: "post" });
    expose(handle);
    return () => {
      const rest = { ...attrs };
      delete rest.onDraw;
      return h("drawing-area", {
        ...rest,
        ref: element,
        ...(props.contentWidth === undefined ? {} : { contentWidth: props.contentWidth }),
        ...(props.contentHeight === undefined ? {} : { contentHeight: props.contentHeight }),
      });
    };
  },
});

export const VGLArea = defineComponent({
  name: "VGLArea",
  inheritAttrs: false,
  props: {
    hasDepthBuffer: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    hasStencilBuffer: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    useEs: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    autoRender: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const context = shallowRef<object | null>(null);
    const error = shallowRef<string | null>(null);
    const observe = (nativeContext: unknown) => {
      const area = element.value?.widget as InstanceType<typeof Gtk.GLArea> | undefined;
      const nativeError = area?.getError() ?? null;
      context.value =
        nativeContext == null ? (area?.getContext() ?? null) : (nativeContext as object);
      error.value = nativeError?.message ?? null;
      // Returning false lets GTK clear the framebuffer unless the caller's handler returns true.
      return false;
    };
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      context,
      error,
      get api() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.GLArea> | undefined)?.getApi() ?? null
        );
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onRender", observe);
      return h("gl-area", {
        ...rest,
        ref: element,
        onRender: handlers,
        ...(props.hasDepthBuffer === undefined ? {} : { hasDepthBuffer: props.hasDepthBuffer }),
        ...(props.hasStencilBuffer === undefined
          ? {}
          : { hasStencilBuffer: props.hasStencilBuffer }),
        ...(props.useEs === undefined ? {} : { useEs: props.useEs }),
        ...(props.autoRender === undefined ? {} : { autoRender: props.autoRender }),
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Value pickers.
 * ---------------------------------------------------------------------------------------------- */

export const VColorButton = defineComponent({
  name: "VColorButton",
  inheritAttrs: false,
  props: {
    rgba: { type: [Object, String] as PropType<RgbaInput>, default: null },
    useAlpha: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    title: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ["update:rgba"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    const apply = () => {
      const button = element.value?.widget as InstanceType<typeof Gtk.ColorButton> | undefined;
      if (!button) return;
      const next = toRgba(props.rgba);
      if (next == null || sameRgba(next, button.getRgba())) return;
      applying = true;
      try {
        button.setRgba(next);
      } finally {
        applying = false;
      }
    };
    const changed = () => {
      if (applying) return;
      const button = element.value?.widget as InstanceType<typeof Gtk.ColorButton> | undefined;
      if (!button) return;
      const next = button.getRgba();
      if (!sameRgba(toRgba(props.rgba), next)) emit("update:rgba", next);
    };
    onMounted(apply);
    watch(() => props.rgba, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get rgba() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.ColorButton> | undefined)?.getRgba() ??
          null
        );
      },
    });
    return () => {
      toRgba(props.rgba); // validate early so an invalid color fails during render
      const { attrs: rest, handlers } = withHandler(attrs, "onColorSet", changed);
      return h("color-button", {
        ...rest,
        ref: element,
        ...(props.useAlpha === undefined ? {} : { useAlpha: props.useAlpha }),
        ...(props.title === undefined ? {} : { title: props.title }),
        onColorSet: handlers,
      });
    };
  },
});

export const VFontButton = defineComponent({
  name: "VFontButton",
  inheritAttrs: false,
  props: {
    font: { type: [Object, String] as PropType<FontInput>, default: null },
    useFont: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    useSize: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    title: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ["update:font"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    const apply = () => {
      const button = element.value?.widget as InstanceType<typeof Gtk.FontButton> | undefined;
      if (!button) return;
      if (props.font == null) return;
      applying = true;
      try {
        if (typeof props.font === "string") {
          if (button.getFont() !== props.font) button.setFont(props.font);
        } else {
          const desc = toFontDescription(props.font);
          if (desc) button.setFontDesc(desc);
        }
      } finally {
        applying = false;
      }
    };
    const changed = () => {
      if (applying) return;
      const button = element.value?.widget as InstanceType<typeof Gtk.FontButton> | undefined;
      if (!button) return;
      const next = button.getFont() ?? "";
      const current =
        typeof props.font === "string" ? props.font : (props.font?.toString?.() ?? "");
      if (next !== current) emit("update:font", next);
    };
    onMounted(apply);
    watch(() => props.font, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get font() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.FontButton> | undefined)?.getFont() ??
          null
        );
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onFontSet", changed);
      const desc = typeof props.font === "string" ? null : toFontDescription(props.font);
      return h("font-button", {
        ...rest,
        ref: element,
        ...(desc == null ? {} : { fontDesc: desc }),
        ...(typeof props.font === "string" ? { font: props.font } : {}),
        ...(props.useFont === undefined ? {} : { useFont: props.useFont }),
        ...(props.useSize === undefined ? {} : { useSize: props.useSize }),
        ...(props.title === undefined ? {} : { title: props.title }),
        onFontSet: handlers,
      });
    };
  },
});

export const VColorDialogButton = defineComponent({
  name: "VColorDialogButton",
  inheritAttrs: false,
  props: {
    rgba: { type: [Object, String] as PropType<RgbaInput>, default: null },
    dialog: { type: Object as PropType<object | null>, default: null },
  },
  emits: ["update:rgba", "color-set"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    let lastEmitted = "";
    const apply = () => {
      const button = element.value?.widget as
        | InstanceType<typeof Gtk.ColorDialogButton>
        | undefined;
      if (!button) return;
      const next = toRgba(props.rgba);
      if (next == null || sameRgba(next, button.getRgba())) return;
      applying = true;
      try {
        button.setRgba(next);
      } finally {
        applying = false;
      }
    };
    const changed = () => {
      if (applying) return;
      const button = element.value?.widget as
        | InstanceType<typeof Gtk.ColorDialogButton>
        | undefined;
      if (!button) return;
      const next = button.getRgba();
      if (sameRgba(toRgba(props.rgba), next)) return;
      const key = next.toString();
      if (key === lastEmitted) return;
      lastEmitted = key;
      emit("update:rgba", next);
      emit("color-set");
    };
    onMounted(apply);
    watch(() => props.rgba, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get rgba() {
        return (
          (
            element.value?.widget as InstanceType<typeof Gtk.ColorDialogButton> | undefined
          )?.getRgba() ?? null
        );
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::rgba", changed);
      return h("color-dialog-button", {
        ...rest,
        ref: element,
        ...(toRgba(props.rgba) == null ? {} : { rgba: toRgba(props.rgba) }),
        ...(nativeDialog(props.dialog, Gtk.ColorDialog) == null
          ? {}
          : { dialog: nativeDialog(props.dialog, Gtk.ColorDialog) }),
        "onNotify::rgba": handlers,
      });
    };
  },
});

export const VFontDialogButton = defineComponent({
  name: "VFontDialogButton",
  inheritAttrs: false,
  props: {
    font: { type: [Object, String] as PropType<FontInput>, default: null },
    dialog: { type: Object as PropType<object | null>, default: null },
    useFont: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    useSize: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:font", "font-set"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    let lastEmitted = "";
    const apply = () => {
      const button = element.value?.widget as InstanceType<typeof Gtk.FontDialogButton> | undefined;
      if (!button) return;
      const desc = toFontDescription(props.font);
      if (!desc) return;
      applying = true;
      try {
        button.setFontDesc(desc);
      } finally {
        applying = false;
      }
    };
    const changed = () => {
      if (applying) return;
      const button = element.value?.widget as InstanceType<typeof Gtk.FontDialogButton> | undefined;
      if (!button) return;
      const next = button.getFontDesc()?.toString?.() ?? "";
      const current =
        typeof props.font === "string" ? props.font : (props.font?.toString?.() ?? "");
      if (next === current || next === lastEmitted) return;
      lastEmitted = next;
      emit("update:font", next);
      emit("font-set");
    };
    onMounted(apply);
    watch(() => props.font, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get font() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.FontDialogButton> | undefined)
            ?.getFontDesc()
            ?.toString?.() ?? null
        );
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::font-desc", changed);
      const desc = toFontDescription(props.font);
      return h("font-dialog-button", {
        ...rest,
        ref: element,
        ...(desc == null ? {} : { fontDesc: desc }),
        ...(nativeDialog(props.dialog, Gtk.FontDialog) == null
          ? {}
          : { dialog: nativeDialog(props.dialog, Gtk.FontDialog) }),
        ...(props.useFont === undefined ? {} : { useFont: props.useFont }),
        ...(props.useSize === undefined ? {} : { useSize: props.useSize }),
        "onNotify::font-desc": handlers,
      });
    };
  },
});

export const VCalendar = defineComponent({
  name: "VCalendar",
  inheritAttrs: false,
  props: {
    date: { type: [Object, String] as PropType<DateInput>, default: null },
    showDayNames: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showHeading: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showWeekNumbers: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:date", "day-selected", "next-month", "prev-month"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    let last = "";
    const calendar = () => element.value?.widget as InstanceType<typeof Gtk.Calendar> | undefined;
    const publish = () => {
      const widget = calendar();
      if (!widget) return;
      const next = widget.getDate();
      if (!next) return;
      last = dateKey(next);
      emit("update:date", next);
    };
    const apply = () => {
      const widget = calendar();
      if (!widget) return;
      const next = toDateTime(props.date);
      if (!next || dateKey(next) === dateKey(widget.getDate())) return;
      applying = true;
      try {
        // `setDate()` is GTK 4.20+; `selectDay()` has the same year/month/day behavior on 4.14+.
        widget.selectDay(next);
      } finally {
        applying = false;
      }
    };
    const onDateChanged = () => {
      if (applying) return;
      const widget = calendar();
      if (!widget) return;
      const next = widget.getDate();
      if (!next || dateKey(next) === last) return;
      publish();
    };
    const onDaySelected = () => {
      onDateChanged();
      emit("day-selected");
    };
    onMounted(apply);
    watch(() => props.date, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get date() {
        return calendar()?.getDate() ?? null;
      },
      get day() {
        return calendar()?.getDay() ?? null;
      },
      get month() {
        const month = calendar()?.getMonth();
        return month === undefined ? null : month + 1;
      },
      get year() {
        return calendar()?.getYear() ?? null;
      },
    });
    return () => {
      const date = withHandler(attrs, "onNotify::date", onDateChanged);
      const day = withHandler(date.attrs, "onDaySelected", onDaySelected);
      const next = withHandler(day.attrs, "onNextMonth", () => emit("next-month"));
      const previous = withHandler(next.attrs, "onPrevMonth", () => emit("prev-month"));
      return h("calendar", {
        ...previous.attrs,
        ref: element,
        ...(props.showDayNames === undefined ? {} : { showDayNames: props.showDayNames }),
        ...(props.showHeading === undefined ? {} : { showHeading: props.showHeading }),
        ...(props.showWeekNumbers === undefined ? {} : { showWeekNumbers: props.showWeekNumbers }),
        "onNotify::date": date.handlers,
        onDaySelected: day.handlers,
        onNextMonth: next.handlers,
        onPrevMonth: previous.handlers,
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * List models.
 * ---------------------------------------------------------------------------------------------- */

/** Build a `Gtk.StringList` from a plain string array. */
export function toStringList(items: readonly string[] = []): InstanceType<typeof Gtk.StringList> {
  return new Gtk.StringList({ strings: [...items] });
}

/** A `Gtk.StringList` kept in sync with a reactive string source. */
export function useStringList(
  items: () => readonly string[] | undefined,
): InstanceType<typeof Gtk.StringList> {
  const list = toStringList(items() ?? []);
  watch(
    items,
    (next) => {
      const values = [...(next ?? [])];
      list.splice(0, list.getNItems(), values);
    },
    { deep: true },
  );
  return list;
}

/** Declarative `Gtk.StringList` resource; renders nothing and exposes the model. */
export const VStringList = defineComponent({
  name: "VStringList",
  props: { items: { type: Array as PropType<string[]>, default: () => [] } },
  setup(props, { expose }) {
    const stringList = useStringList(() => props.items);
    expose({
      stringList,
      list: stringList,
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

export interface FilterListModelHandle {
  readonly filterListModel: InstanceType<typeof Gtk.FilterListModel>;
  readonly filter: InstanceType<typeof Gtk.CustomFilter>;
  /** Replace the predicate and refilter the model. */
  setPredicate(predicate: (item: object) => boolean): void;
  /** Ask the filter to re-evaluate every item. */
  refilter(): void;
}

/**
 * `Gtk.FilterListModel` + `Gtk.CustomFilter`. node-gtk marshals the boolean return of a
 * `Gtk.CustomFilterFunc` correctly (verified on 4.1.1), unlike `Gtk.CustomSorter` pointers.
 */
export function useFilterListModel(
  model: MaybeGetter<ListModel | null>,
  predicate: (item: object) => boolean,
): FilterListModelHandle {
  let current = predicate;
  const filter = Gtk.CustomFilter.new((item) => Boolean(current(item as object)));
  const filterListModel = Gtk.FilterListModel.new(read(model), filter);
  if (isGetter(model)) watch(model, (next) => filterListModel.setModel(next), { flush: "post" });
  const refilter = () => filter.changed(Gtk.FilterChange.DIFFERENT);
  onScopeDispose(() => filterListModel.setModel(null));
  return {
    filterListModel,
    filter,
    setPredicate(next) {
      current = next;
      refilter();
    },
    refilter,
  };
}

export const VFilterListModel = defineComponent({
  name: "VFilterListModel",
  props: {
    model: { type: Object as PropType<ListModel | null>, default: null },
    predicate: { type: Function as PropType<(item: object) => boolean>, required: true },
    /** Accepted for API symmetry; `Gtk.FilterListModel` on GTK 4.24 has no `autoexpand`. */
    autoexpand: { type: Boolean, default: false },
  },
  setup(props, { expose }) {
    const handle = useFilterListModel(
      () => props.model,
      (item) => Boolean(props.predicate(item)),
    );
    watch(
      () => props.predicate,
      (next) => handle.setPredicate((item) => Boolean(next(item))),
    );
    expose({
      filterListModel: handle.filterListModel,
      filter: handle.filter,
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

let sorterClass:
  | ((new () => InstanceType<typeof Gtk.Sorter>) & {
      prototype: InstanceType<typeof Gtk.Sorter> & {
        compareFn: (a: object, b: object) => number;
      };
    })
  | null = null;

/**
 * node-gtk 4.1.1 does not marshal the `gconstpointer` arguments of `GtkCustomSorterFunc`
 * (verified: every argument arrives as `undefined`). A JS `Gtk.Sorter` subclass receives typed
 * objects, so the comparator keeps working without CustomSorter.
 */
function comparatorSorterClass() {
  if (sorterClass) return sorterClass;
  // node-gtk 4.1.1 crashes inside `Gtk.Sorter::compare` (gconstpointer arguments) on GTK 4.22,
  // so the JS comparator is only safe on 4.24+; see docs/media.md.
  requireGtkVersion("VSortListModel", 4, 24);
  class VioComparatorSorter extends Gtk.Sorter {
    compareFn: (a: object, b: object) => number = () => 0;
    virtual_compare(a: object | null, b: object | null): number {
      if (!a || !b) return Gtk.Ordering.EQUAL;
      const result = this.compareFn(a, b) ?? 0;
      if (result < 0) return Gtk.Ordering.SMALLER;
      if (result > 0) return Gtk.Ordering.LARGER;
      return Gtk.Ordering.EQUAL;
    }
  }
  registerClass(VioComparatorSorter);
  sorterClass = VioComparatorSorter as unknown as typeof sorterClass;
  return VioComparatorSorter;
}

export interface SortListModelHandle {
  readonly sortListModel: InstanceType<typeof Gtk.SortListModel>;
  readonly sorter: InstanceType<typeof Gtk.Sorter>;
  /** Replace the comparator and resort. */
  setCompare(compare: (a: object, b: object) => number): void;
  /** Ask the sorter to re-evaluate every item. */
  invalidate(): void;
}

/** `Gtk.SortListModel` with a JS comparator; see `comparatorSorterClass()` for the deviation. */
export function useSortListModel(
  model: MaybeGetter<ListModel | null>,
  compare: (a: object, b: object) => number = () => 0,
): SortListModelHandle {
  const Sorter = comparatorSorterClass();
  const sorter = markRaw(new Sorter()) as InstanceType<typeof Gtk.Sorter> & {
    compareFn: (a: object, b: object) => number;
  };
  sorter.compareFn = compare;
  const sortListModel = Gtk.SortListModel.new(read(model), sorter);
  if (isGetter(model)) watch(model, (next) => sortListModel.setModel(next), { flush: "post" });
  const invalidate = () => sorter.changed(Gtk.SorterChange.DIFFERENT);
  onScopeDispose(() => sortListModel.setModel(null));
  return {
    sortListModel,
    sorter,
    setCompare(next) {
      sorter.compareFn = next;
      invalidate();
    },
    invalidate,
  };
}

export const VSortListModel = defineComponent({
  name: "VSortListModel",
  props: {
    model: { type: Object as PropType<ListModel | null>, default: null },
    compare: {
      type: Function as PropType<(a: object, b: object) => number>,
      default: () => 0,
    },
  },
  setup(props, { expose }) {
    const handle = useSortListModel(() => props.model, props.compare);
    watch(
      () => props.compare,
      (next) => handle.setCompare(next),
    );
    expose({
      sortListModel: handle.sortListModel,
      sorter: handle.sorter,
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

/* ------------------------------------------------------------------------------------------------
 * Selection helpers for `VColumnView` / `VGridView`.
 * ---------------------------------------------------------------------------------------------- */

function sameIndices(value: number | number[], indices: number[]): boolean {
  const left = Array.isArray(value) ? value : value < 0 ? [] : [value];
  return left.length === indices.length && left.every((item, index) => item === indices[index]);
}

function selectedIndices(selection: SelectionModel, multiple: boolean): number[] {
  if (!multiple) {
    const selected = (selection as InstanceType<typeof Gtk.SingleSelection>).getSelected();
    return selected === Gtk.INVALID_LIST_POSITION ? [] : [selected];
  }
  const bitset = selection.getSelection();
  const indices: number[] = [];
  for (let index = 0; index < selection.getNItems(); index++)
    if (bitset.contains(index)) indices.push(index);
  return indices;
}

export interface SingleSelectionHandle {
  readonly selection: InstanceType<typeof Gtk.SingleSelection>;
  /** Current position, `-1` when nothing is selected. Bind it to `VColumnView:selected`. */
  readonly selected: Ref<number>;
  readonly selectedItem: Ref<object | null>;
  setSelected(index: number): void;
}

export function useSingleSelection(model: MaybeGetter<ListModel | null>): SingleSelectionHandle {
  const selection = new Gtk.SingleSelection({
    model: read(model) ?? undefined,
    autoselect: false,
    canUnselect: true,
  });
  // GtkSingleSelection selects row 0 when a model is attached, even with autoselect disabled.
  // The helper starts with "nothing selected", matching `selected: -1` on the views.
  selection.setSelected(Gtk.INVALID_LIST_POSITION);
  const selected = shallowRef<number>(-1);
  const selectedItem = shallowRef<object | null>(null);
  let applying = false;
  const sync = () => {
    const indices = selectedIndices(selection, false);
    selected.value = indices[0] ?? -1;
    selectedItem.value = selection.getSelectedItem() ?? null;
  };
  const changed = () => {
    if (!applying) sync();
  };
  selection.on("selection-changed", changed);
  const setSelected = (index: number) => {
    if (selection.getSelected() === index) return;
    applying = true;
    try {
      selection.setSelected(index);
    } finally {
      applying = false;
    }
    sync();
  };
  watch(selected, (value) => {
    if (!applying) setSelected(value);
  });
  if (isGetter(model))
    watch(
      model,
      (next) => {
        const previous = selected.value;
        selection.setModel(next);
        if (previous === -1) selection.setSelected(Gtk.INVALID_LIST_POSITION);
        sync();
      },
      { flush: "post" },
    );
  onScopeDispose(() => {
    selection.off("selection-changed", changed);
    selection.setModel(null);
  });
  sync();
  return { selection, selected, selectedItem, setSelected };
}

export interface MultiSelectionHandle {
  readonly selection: InstanceType<typeof Gtk.MultiSelection>;
  /** Selected positions; bind it to `VColumnView:selected` in `multiple` mode. */
  readonly selected: Ref<number[]>;
  readonly selectedItems: Ref<object[]>;
  select(index: number): void;
  unselect(index: number): void;
  selectAll(): void;
  unselectAll(): void;
}

export function useMultiSelection(model: MaybeGetter<ListModel | null>): MultiSelectionHandle {
  const selection = Gtk.MultiSelection.new(read(model));
  const selected = shallowRef<number[]>([]);
  const selectedItems = shallowRef<object[]>([]);
  let applying = false;
  const sync = () => {
    const indices = selectedIndices(selection, true);
    selected.value = indices;
    const items: object[] = [];
    for (const index of indices) {
      const item = selection.getItem(index);
      if (item) items.push(item);
    }
    selectedItems.value = items;
  };
  const changed = () => {
    if (!applying) sync();
  };
  selection.on("selection-changed", changed);
  const apply = (indices: number[]) => {
    applying = true;
    try {
      selection.unselectAll();
      for (const index of indices)
        if (index >= 0 && index < selection.getNItems()) selection.selectItem(index, false);
    } finally {
      applying = false;
    }
    sync();
  };
  watch(selected, (value) => {
    if (!applying && !sameIndices(value, selectedIndices(selection, true))) apply(value);
  });
  if (isGetter(model))
    watch(
      model,
      (next) => {
        selection.setModel(next);
        sync();
      },
      { flush: "post" },
    );
  onScopeDispose(() => {
    selection.off("selection-changed", changed);
    selection.setModel(null);
  });
  sync();
  return {
    selection,
    selected,
    selectedItems,
    select(index) {
      apply([...selected.value.filter((item) => item !== index), index].sort((a, b) => a - b));
    },
    unselect(index) {
      apply(selected.value.filter((item) => item !== index));
    },
    selectAll() {
      apply(Array.from({ length: selection.getNItems() }, (_, index) => index));
    },
    unselectAll() {
      apply([]);
    },
  };
}

export interface NoSelectionHandle {
  readonly selection: InstanceType<typeof Gtk.NoSelection>;
  /** Always `-1`; kept so a view can share one binding shape. */
  readonly selected: Ref<number>;
}

export function useNoSelection(model: MaybeGetter<ListModel | null>): NoSelectionHandle {
  const selection = Gtk.NoSelection.new(read(model));
  const selected = shallowRef<number>(-1);
  if (isGetter(model)) watch(model, (next) => selection.setModel(next), { flush: "post" });
  onScopeDispose(() => selection.setModel(null));
  return { selection, selected };
}
