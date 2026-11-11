import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import Pango from "gi:Pango-1.0";
import { getGType } from "node-gtk";
import {
  defineComponent,
  h,
  markRaw,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
  type PropType,
} from "@vue/runtime-core";
import type { VioElement, VioNode } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";
import { releaseSlot } from "./containers.ts";
import { applyFontSelectionWhenReady } from "./font-chooser.ts";

type Attrs = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;
type NativeWindow = InstanceType<typeof Gtk.Window>;
type NativeFile = ReturnType<typeof Gio.File.newForPath>;

/**
 * Identifiers produced by a dialog response. Stock GTK dialogs emit their numeric
 * `Gtk.ResponseType`; `VDialog` custom buttons may use strings as well.
 */
export type ResponseId = number | string;

export interface DialogButton {
  id: ResponseId;
  label: string;
  /** Default (Enter) button; GTK adds the `default` CSS class. */
  default?: boolean;
  /** Suggested (accented) action. */
  suggested?: boolean;
}

export interface FileFilterSpec {
  name: string;
  mimeTypes?: string[];
  patterns?: string[];
}
export type FileFilterInput = InstanceType<typeof Gtk.FileFilter> | FileFilterSpec;

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

/** Keep the caller's signal handler and append the component's model handler. */
function withHandler(attrs: Attrs, key: string, handler: Handler) {
  const rest = { ...attrs };
  const user = rest[key];
  delete rest[key];
  return { attrs: rest, handlers: [handler, ...callbacks(user)] as Handler[] };
}

function callbacks(value: unknown): Handler[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as Handler[]) : [value as Handler];
}

function define(type: string, definition: WidgetDefinition): WidgetDefinition {
  if (!hasWidget(type)) registerWidget(type, definition);
  const registered = getWidgetDefinition(type);
  if (!registered) throw new Error(`vio: failed to register '${type}'`);
  return registered;
}

/* ------------------------------------------------------------------------------------------------
 * Shared helpers.
 * ---------------------------------------------------------------------------------------------- */

/** Accept a native window, a component ref (`{ widget }`) or `null`. */
export function nativeWindow(value: unknown): NativeWindow | null {
  if (value == null) return null;
  const candidate = (value as { widget?: unknown }).widget ?? value;
  return candidate instanceof Gtk.Window ? candidate : null;
}

const trackedWindows = new WeakSet<object>();

function trackWindow(window: NativeWindow): void {
  if (trackedWindows.has(window)) return;
  trackedWindows.add(window);
  window.on("destroy", () => {
    trackedWindows.delete(window);
  });
}

/**
 * Async dialogs need a live parent. `Gtk.Window.listToplevels()` keeps unrealized windows and
 * drops destroyed ones, so it distinguishes "not shown yet" from "already destroyed".
 */
function requireParent(value: unknown, label: string): NativeWindow {
  const parent = nativeWindow(value);
  if (!parent) throw new Error(`vio: ${label} requires a Gtk.Window parent`);
  trackWindow(parent);
  if (!Gtk.Window.listToplevels().includes(parent))
    throw new Error(`vio: ${label} parent window has been destroyed`);
  return parent;
}

/**
 * `Gtk.FileDialog` aborts the process on GTK 4.24.1/X11 when a realized parent is passed and the
 * operation is cancelled. Keep the parent for validation, but only hand it to GTK while it is not
 * realized; the native dialog then opens unparented instead of crashing. See docs/dialogs.md.
 */
function fileDialogParent(parent: NativeWindow): NativeWindow | null {
  return parent.getRealized() ? null : parent;
}

export function toFileFilters(
  input: FileFilterInput[] | undefined,
): Array<InstanceType<typeof Gtk.FileFilter>> {
  const result: Array<InstanceType<typeof Gtk.FileFilter>> = [];
  for (const spec of input ?? []) {
    if (spec instanceof Gtk.FileFilter) {
      result.push(spec);
      continue;
    }
    const filter = new Gtk.FileFilter();
    filter.setName(spec.name);
    for (const mimeType of spec.mimeTypes ?? []) filter.addMimeType(mimeType);
    for (const pattern of spec.patterns ?? []) filter.addPattern(pattern);
    result.push(filter);
  }
  return result;
}

const messageTypes: Record<string, number> = {
  info: Gtk.MessageType.INFO,
  warning: Gtk.MessageType.WARNING,
  question: Gtk.MessageType.QUESTION,
  error: Gtk.MessageType.ERROR,
  other: Gtk.MessageType.OTHER,
};

const messageButtons: Record<string, Array<{ id: number; label: string }>> = {
  none: [],
  ok: [{ id: Gtk.ResponseType.OK, label: "OK" }],
  close: [{ id: Gtk.ResponseType.CLOSE, label: "Close" }],
  cancel: [{ id: Gtk.ResponseType.CANCEL, label: "Cancel" }],
  "yes-no": [
    { id: Gtk.ResponseType.YES, label: "Yes" },
    { id: Gtk.ResponseType.NO, label: "No" },
  ],
  "ok-cancel": [
    { id: Gtk.ResponseType.OK, label: "OK" },
    { id: Gtk.ResponseType.CANCEL, label: "Cancel" },
  ],
};

const chooserActions: Record<string, number> = {
  open: Gtk.FileChooserAction.OPEN,
  save: Gtk.FileChooserAction.SAVE,
  "select-folder": Gtk.FileChooserAction.SELECT_FOLDER,
};

function chooserActionOf(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (value === undefined) return Gtk.FileChooserAction.OPEN;
  const action = chooserActions[value];
  if (action === undefined) throw new Error(`vio: unknown file chooser action '${value}'`);
  return action;
}

const pageTypes: Record<string, number> = {
  content: Gtk.AssistantPageType.CONTENT,
  intro: Gtk.AssistantPageType.INTRO,
  confirm: Gtk.AssistantPageType.CONFIRM,
  summary: Gtk.AssistantPageType.SUMMARY,
  progress: Gtk.AssistantPageType.PROGRESS,
  custom: Gtk.AssistantPageType.CUSTOM,
};

function pageTypeOf(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (value === undefined) return Gtk.AssistantPageType.CONTENT;
  const type = pageTypes[value];
  if (type === undefined) throw new Error(`vio: unknown assistant page type '${value}'`);
  return type;
}

function licenseOf(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const key = value.toUpperCase().replaceAll("-", "_");
  const license = (Gtk.License as unknown as Record<string, number>)[key];
  if (license === undefined) throw new Error(`vio: unknown license type '${value}'`);
  return license;
}

function fontLevelOf(value: number | string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const names = Array.isArray(value) ? value : value.split("|");
  let level = 0;
  for (const name of names) {
    const key = name.trim().toUpperCase();
    const flag = (Gtk.FontChooserLevel as unknown as Record<string, number>)[key];
    if (flag === undefined) throw new Error(`vio: unknown font chooser level '${name}'`);
    level |= flag;
  }
  return level;
}

function fontDescriptionOf(value: unknown): InstanceType<typeof Pango.FontDescription> | null {
  if (value == null) return null;
  if (value instanceof Pango.FontDescription) return value;
  if (typeof value === "string") return Pango.FontDescription.fromString(value);
  throw new Error(`vio: font-desc must be a Pango.FontDescription or a font name string`);
}

function isPrivate(value: unknown): boolean {
  return value == null;
}

/** Node-gtk rejects `null` for most string parameters; an empty string clears the value. */
function clearable(value: string | null | undefined): string {
  return value ?? "";
}

function buttonOf(value: unknown): InstanceType<typeof Gtk.Button> {
  return value as InstanceType<typeof Gtk.Button>;
}

/** A boolean-return signal such as `Gtk.AboutDialog::activate-link`; default to `false`. */
function booleanHandler(attrs: Attrs, key: string) {
  const rest = { ...attrs };
  const user = rest[key];
  delete rest[key];
  const handlers = callbacks(user);
  return {
    attrs: rest,
    handler: (...args: unknown[]) => {
      let handled = false;
      for (const callback of handlers) if (callback(...args) === true) handled = true;
      return handled;
    },
  };
}

/** `*_finish()` takes a `Gio.AsyncResult`; node-gtk does not narrow unknown callback payloads. */
type AsyncResultArgument = Parameters<InstanceType<typeof Gtk.AlertDialog>["chooseFinish"]>[0];
function asyncResult(value: unknown): AsyncResultArgument {
  return value as AsyncResultArgument;
}

/* ------------------------------------------------------------------------------------------------
 * Async GObject dialogs (AlertDialog, FileDialog, ColorDialog, FontDialog).
 * ---------------------------------------------------------------------------------------------- */

interface PendingOperation {
  cancellable: InstanceType<typeof Gio.Cancellable>;
  settled: boolean;
  cancel(): void;
}

function useAsyncRunner(name: string, emitError: (error: Error) => void) {
  let pending: PendingOperation | null = null;
  const cancel = (): boolean => {
    if (!pending) return false;
    pending.cancel();
    pending = null;
    return true;
  };
  const run = <T>(
    start: (
      callback: (result: unknown) => void,
      cancellable: InstanceType<typeof Gio.Cancellable>,
    ) => void,
    finish: (result: unknown) => T | null,
  ): Promise<T | null> => {
    if (pending)
      throw new Error(
        `vio: ${name} is already pending; await it or call cancel() before starting a new one`,
      );
    const cancellable = new Gio.Cancellable();
    let resolvePromise!: (value: T | null) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<T | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    let cancelled = false;
    const operation: PendingOperation = {
      cancellable,
      settled: false,
      cancel() {
        if (operation.settled) return;
        operation.settled = true;
        cancelled = true;
        try {
          cancellable.cancel();
        } catch {
          // A cancelled Gio.Cancellable is already in the requested state.
        }
        resolvePromise(null);
      },
    };
    pending = operation;
    try {
      start((result) => {
        if (operation.settled) return;
        operation.settled = true;
        if (pending === operation) pending = null;
        let value: T | null;
        try {
          value = finish(result);
        } catch (error) {
          const reason = error instanceof Error ? error : new Error(String(error));
          if (cancelled || /cancel|dismiss/i.test(reason.message)) resolvePromise(null);
          else {
            emitError(reason);
            rejectPromise(reason);
          }
          return;
        }
        resolvePromise(value);
      }, cancellable);
    } catch (error) {
      operation.settled = true;
      if (pending === operation) pending = null;
      throw error instanceof Error ? error : new Error(String(error));
    }
    return promise;
  };
  return {
    run,
    cancel,
    get pending() {
      return pending !== null;
    },
    dispose() {
      cancel();
    },
  };
}

/** A `Gtk.AlertDialog` controller: no widget, `choose()` returns the button index. */
export const VAlertDialog = defineComponent({
  name: "VAlertDialog",
  props: {
    message: { type: String, default: "" },
    detail: { type: String as PropType<string | undefined>, default: undefined },
    buttons: { type: Array as PropType<string[]>, default: () => ["OK"] },
    cancelButton: { type: Number as PropType<number | undefined>, default: undefined },
    defaultButton: { type: Number as PropType<number | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["response", "cancel", "error"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(new Gtk.AlertDialog());
    const runner = useAsyncRunner("VAlertDialog.choose()", (error) => emit("error", error));
    const sync = () => {
      dialog.setMessage(props.message);
      dialog.setDetail(clearable(props.detail));
      if (props.buttons !== undefined) dialog.setButtons(props.buttons);
      if (props.cancelButton !== undefined) dialog.setCancelButton(props.cancelButton);
      if (props.defaultButton !== undefined) dialog.setDefaultButton(props.defaultButton);
      if (props.modal !== undefined) dialog.setModal(props.modal);
    };
    sync();
    watch(
      () =>
        [
          props.message,
          props.detail,
          props.buttons,
          props.cancelButton,
          props.defaultButton,
          props.modal,
        ] as const,
      sync,
      { deep: true, flush: "post" },
    );
    const choose = (parent: unknown): Promise<number | null> => {
      const window = requireParent(parent, "VAlertDialog.choose()");
      return runner.run<number>(
        (callback, cancellable) => {
          dialog.choose(window, cancellable, (...args: unknown[]) => callback(args[1]));
        },
        (result) => {
          const response = dialog.chooseFinish(asyncResult(result));
          emit("response", response);
          return response;
        },
      );
    };
    const show = (parent: unknown) => choose(parent);
    onUnmounted(() => runner.dispose());
    expose({
      dialog,
      choose,
      show,
      cancel: () => {
        const cancelled = runner.cancel();
        if (cancelled) emit("cancel");
        return cancelled;
      },
      get pending() {
        return runner.pending;
      },
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

export const VFileDialog = defineComponent({
  name: "VFileDialog",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    initialName: { type: String as PropType<string | undefined>, default: undefined },
    acceptLabel: { type: String as PropType<string | undefined>, default: undefined },
    filters: { type: Array as PropType<FileFilterInput[]>, default: () => [] },
    defaultFilter: {
      type: Object as PropType<FileFilterInput | null>,
      default: null,
    },
  },
  emits: ["open", "save", "cancel", "error"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(new Gtk.FileDialog());
    const runner = useAsyncRunner("VFileDialog", (error) => emit("error", error));
    const filterStore = shallowRef<InstanceType<typeof Gio.ListStore> | null>(null);
    const syncFilters = () => {
      const specs = props.filters ?? [];
      const filters = toFileFilters(specs);
      const store = Gio.ListStore.new(getGType(Gtk.FileFilter));
      for (const filter of filters) store.append(filter);
      filterStore.value = store;
      dialog.setFilters(store);
      let wanted = filters[0] ?? null;
      const spec = props.defaultFilter;
      if (spec instanceof Gtk.FileFilter) wanted = spec;
      else if (spec != null) {
        const index = specs.indexOf(spec);
        if (index !== -1) wanted = filters[index] ?? wanted;
      }
      dialog.setDefaultFilter(wanted);
    };
    const sync = () => {
      dialog.setTitle(clearable(props.title));
      if (props.modal !== undefined) dialog.setModal(props.modal);
      dialog.setInitialName(props.initialName ?? null);
      dialog.setAcceptLabel(props.acceptLabel ?? null);
      syncFilters();
    };
    sync();
    watch(() => [props.title, props.modal, props.initialName, props.acceptLabel] as const, sync, {
      flush: "post",
    });
    watch(() => [props.filters, props.defaultFilter] as const, syncFilters, {
      deep: true,
      flush: "post",
    });
    const open = (parent: unknown): Promise<NativeFile | null> => {
      const window = requireParent(parent, "VFileDialog.open()");
      return runner.run<NativeFile>(
        (callback, cancellable) => {
          dialog.open(fileDialogParent(window), cancellable, (...args: unknown[]) =>
            callback(args[1]),
          );
        },
        (result) => {
          const file = dialog.openFinish(asyncResult(result));
          emit("open", file);
          return file;
        },
      );
    };
    const save = (parent: unknown): Promise<NativeFile | null> => {
      const window = requireParent(parent, "VFileDialog.save()");
      return runner.run<NativeFile>(
        (callback, cancellable) => {
          dialog.save(fileDialogParent(window), cancellable, (...args: unknown[]) =>
            callback(args[1]),
          );
        },
        (result) => {
          const file = dialog.saveFinish(asyncResult(result));
          emit("save", file);
          return file;
        },
      );
    };
    onUnmounted(() => runner.dispose());
    expose({
      dialog,
      open,
      save,
      cancel: () => {
        const cancelled = runner.cancel();
        if (cancelled) emit("cancel");
        return cancelled;
      },
      get pending() {
        return runner.pending;
      },
      get filters() {
        return filterStore.value;
      },
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

export const VColorDialog = defineComponent({
  name: "VColorDialog",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    withAlpha: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["color", "cancel", "error"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(new Gtk.ColorDialog());
    const runner = useAsyncRunner("VColorDialog.chooseRgba()", (error) => emit("error", error));
    const sync = () => {
      dialog.setTitle(clearable(props.title));
      if (props.modal !== undefined) dialog.setModal(props.modal);
      if (props.withAlpha !== undefined) dialog.setWithAlpha(props.withAlpha);
    };
    sync();
    watch(() => [props.title, props.modal, props.withAlpha] as const, sync, { flush: "post" });
    const chooseRgba = (
      parent: unknown,
      initialColor: InstanceType<typeof Gdk.RGBA> | null = null,
    ): Promise<InstanceType<typeof Gdk.RGBA> | null> => {
      const window = requireParent(parent, "VColorDialog.chooseRgba()");
      return runner.run<InstanceType<typeof Gdk.RGBA>>(
        (callback, cancellable) => {
          dialog.chooseRgba(window, initialColor, cancellable, (...args: unknown[]) =>
            callback(args[1]),
          );
        },
        (result) => {
          const color = dialog.chooseRgbaFinish(asyncResult(result));
          emit("color", color);
          return color;
        },
      );
    };
    onUnmounted(() => runner.dispose());
    expose({
      dialog,
      open: chooseRgba,
      chooseRgba,
      cancel: () => {
        const cancelled = runner.cancel();
        if (cancelled) emit("cancel");
        return cancelled;
      },
      get pending() {
        return runner.pending;
      },
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

export const VFontDialog = defineComponent({
  name: "VFontDialog",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** Initial font selection; without one GTK opens with no row selected and Select is insensitive. */
    fontDesc: { type: [Object, String] as PropType<unknown>, default: null },
  },
  emits: ["font", "cancel", "error"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(new Gtk.FontDialog());
    const runner = useAsyncRunner("VFontDialog.chooseFont()", (error) => emit("error", error));
    const sync = () => {
      dialog.setTitle(clearable(props.title));
      if (props.modal !== undefined) dialog.setModal(props.modal);
    };
    sync();
    watch(() => [props.title, props.modal] as const, sync, { flush: "post" });
    const chooseFont = (
      parent: unknown,
      initialFont: InstanceType<typeof Pango.FontDescription> | null = null,
    ): Promise<InstanceType<typeof Pango.FontDescription> | null> => {
      const window = requireParent(parent, "VFontDialog.chooseFont()");
      const initial = initialFont ?? fontDescriptionOf(props.fontDesc);
      let stopWaiting: (() => void) | null = null;
      return runner
        .run<InstanceType<typeof Pango.FontDescription>>(
          (callback, cancellable) => {
            dialog.chooseFont(window, initial, cancellable, (...args: unknown[]) =>
              callback(args[1]),
            );
            if (initial) {
              console.error("[vio-debug] preselect scheduled");
              stopWaiting = applyFontSelectionWhenReady(window, initial);
            } else console.error("[vio-debug] no initial font");
          },
          (result) => {
            const font = dialog.chooseFontFinish(asyncResult(result));
            emit("font", font);
            return font;
          },
        )
        .finally(() => {
          stopWaiting?.();
          stopWaiting = null;
        });
    };
    onUnmounted(() => runner.dispose());
    expose({
      dialog,
      open: chooseFont,
      chooseFont,
      cancel: () => {
        const cancelled = runner.cancel();
        if (cancelled) emit("cancel");
        return cancelled;
      },
      get pending() {
        return runner.pending;
      },
      get widget() {
        return null;
      },
    });
    return () => null;
  },
});

/* ------------------------------------------------------------------------------------------------
 * Window roots.
 * ---------------------------------------------------------------------------------------------- */

/** GTK's close-request expects a boolean: `true` keeps the window open. */
function closeRequestHandler(attrs: Attrs) {
  const rest = { ...attrs };
  const user = rest.onCloseRequest;
  delete rest.onCloseRequest;
  const handlers = callbacks(user);
  return {
    attrs: rest,
    handler: (...args: unknown[]) => {
      let explicit = false;
      for (const callback of handlers) {
        const result = callback(...args);
        if (typeof result === "boolean") explicit = true;
      }
      // GTK convention is `true`; `false` is the Vue preventDefault convention requested by the
      // wave 3 API. A handler that returns nothing lets the default close proceed.
      return explicit;
    },
  };
}

export const VWindow = defineComponent({
  name: "VWindow",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    defaultWidth: { type: Number as PropType<number | undefined>, default: undefined },
    defaultHeight: { type: Number as PropType<number | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    resizable: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    decorated: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
    destroyWithParent: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["destroy"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    const transient = () => nativeWindow(props.transientFor);
    // Gtk.Widget::destroy has `when=cleanup` / `no-hooks` in GTK 4.24 and cannot be observed as a
    // normal signal, so the Vue event is tied to the component lifetime and the exposed destroy().
    const destroy = () => {
      const window = element.value?.widget as NativeWindow | undefined;
      emit("destroy");
      window?.destroy();
    };
    onUnmounted(() => emit("destroy"));
    expose({ ...handle, destroy });
    return () => {
      const { attrs: rest, handler } = closeRequestHandler(attrs);
      const parent = transient();
      return h(
        "window",
        {
          ...rest,
          ref: element,
          ...(props.title === undefined ? {} : { title: props.title }),
          ...(props.defaultWidth === undefined ? {} : { defaultWidth: props.defaultWidth }),
          ...(props.defaultHeight === undefined ? {} : { defaultHeight: props.defaultHeight }),
          ...(props.modal === undefined ? {} : { modal: props.modal }),
          ...(props.resizable === undefined ? {} : { resizable: props.resizable }),
          ...(props.decorated === undefined ? {} : { decorated: props.decorated }),
          ...(parent == null ? {} : { transientFor: parent }),
          ...(props.destroyWithParent === undefined
            ? {}
            : { destroyWithParent: props.destroyWithParent }),
          onCloseRequest: handler,
        },
        slots.default?.(),
      );
    };
  },
});

const applicationWindows = new Map<string, InstanceType<typeof Gtk.Application>>();

function applicationFor(
  application: unknown,
  applicationId: string,
  flags: number,
): InstanceType<typeof Gtk.Application> {
  const supplied = application instanceof Gtk.Application ? application : null;
  if (supplied) return supplied;
  const existing = applicationWindows.get(applicationId);
  if (existing) return existing;
  const created = new Gtk.Application({ applicationId, flags });
  try {
    if (!created.register(null))
      throw new Error(`application '${applicationId}' is already registered`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`vio: cannot register Gtk.Application '${applicationId}': ${reason}`);
  }
  applicationWindows.set(applicationId, created);
  return created;
}

const applicationWindowDefinition: WidgetDefinition = {
  create: () => new Gtk.ApplicationWindow(),
  children: "single",
  insertChild({ parent, parentWidget, child, role }) {
    if (role === "titlebar") {
      (parentWidget as NativeWindow).setTitlebar(child);
      return;
    }
    const content = parent.children.filter((node) => node.widget && node.props.role !== "titlebar");
    if (content.length > 1)
      throw new Error(
        `vio: 'vio-application-window' accepts one widget child; wrap siblings in VBox`,
      );
    (parentWidget as NativeWindow).setChild(child);
  },
  removeChild({ parentWidget, child, role }) {
    const window = parentWidget as NativeWindow;
    if (role === "titlebar") {
      if (window.getTitlebar() === child) window.setTitlebar(null);
      return;
    }
    if (window.getChild() === child) window.setChild(null);
  },
};

define("vio-application-window", applicationWindowDefinition);

export const VApplicationWindow = defineComponent({
  name: "VApplicationWindow",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    application: { type: Object as PropType<unknown>, default: null },
    applicationId: { type: String, default: "io.github.zede.vio.application" },
    applicationFlags: { type: Number, default: Gio.ApplicationFlags.NON_UNIQUE },
    defaultWidth: { type: Number as PropType<number | undefined>, default: undefined },
    defaultHeight: { type: Number as PropType<number | undefined>, default: undefined },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["activate", "quit", "shutdown"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    const application = shallowRef<InstanceType<typeof Gtk.Application> | null>(null);
    const onActivate = () => emit("activate");
    const onShutdown = () => emit("shutdown");
    const attach = () => {
      const window = element.value?.widget as NativeWindow | undefined;
      if (!window) return;
      const app = applicationFor(props.application, props.applicationId, props.applicationFlags);
      application.value = app;
      if (window.getApplication() !== app) window.setApplication(app);
    };
    onMounted(() => {
      const app = applicationFor(props.application, props.applicationId, props.applicationFlags);
      app.on("activate", onActivate);
      app.on("shutdown", onShutdown);
      attach();
    });
    onUnmounted(() => {
      const app = application.value;
      app?.off("activate", onActivate);
      app?.off("shutdown", onShutdown);
      const window = element.value?.widget as NativeWindow | undefined;
      if (window && app && window.getApplication() === app) window.setApplication(null);
    });
    expose({
      ...handle,
      get application() {
        return application.value;
      },
      activate() {
        application.value?.activate();
      },
      quit() {
        application.value?.quit();
        emit("quit");
      },
      get window() {
        return element.value?.widget ?? null;
      },
    });
    return () =>
      h(
        "vio-application-window",
        {
          ...attrs,
          ref: element,
          ...(props.title === undefined ? {} : { title: props.title }),
          ...(props.defaultWidth === undefined ? {} : { defaultWidth: props.defaultWidth }),
          ...(props.defaultHeight === undefined ? {} : { defaultHeight: props.defaultHeight }),
          ...(props.visible === undefined ? {} : { visible: props.visible }),
        },
        slots.default?.(),
      );
  },
});

/* ------------------------------------------------------------------------------------------------
 * Assistant pages.
 * ---------------------------------------------------------------------------------------------- */

function assistantPageIndex(
  assistant: InstanceType<typeof Gtk.Assistant>,
  page: InstanceType<typeof Gtk.Widget>,
): number {
  for (let index = 0; index < assistant.getNPages(); index++)
    if (assistant.getNthPage(index) === page) return index;
  return -1;
}

define("vio-assistant", {
  create: () => new Gtk.Assistant(),
  children: "none",
  insertChild({ parentWidget, child, parent, index }) {
    const assistant = parentWidget as InstanceType<typeof Gtk.Assistant>;
    const current = assistant.getCurrentPage();
    const currentWidget = current >= 0 ? assistant.getNthPage(current) : null;
    const existing = assistantPageIndex(assistant, child);
    if (existing === -1) {
      const position = Math.max(0, Math.min(index, assistant.getNPages()));
      assistant.insertPage(child, position);
    } else if (existing !== index) {
      assistant.removePage(existing);
      const position = Math.max(0, Math.min(index, assistant.getNPages()));
      assistant.insertPage(child, position);
    }
    if (currentWidget) {
      const restored = assistantPageIndex(assistant, currentWidget);
      if (restored !== -1 && assistant.getCurrentPage() !== restored)
        assistant.setCurrentPage(restored);
    }
    const metadata = parent.children.find((node) => node.widget === child);
    if (metadata) applyAssistantPage(assistant, child, metadata);
  },
  removeChild({ parentWidget, child }) {
    const assistant = parentWidget as InstanceType<typeof Gtk.Assistant>;
    const index = assistantPageIndex(assistant, child);
    if (index !== -1) assistant.removePage(index);
    // Gtk.Assistant::remove-page drops the page from the page list but leaves it parented to the
    // assistant's internal GtkStack. Unparenting releases the removed subtree; without it the
    // page keeps a live parent and the stack keeps a reference after Vue dropped the VNode.
    if (child.getParent()) child.unparent();
  },
});

function applyAssistantPage(
  assistant: InstanceType<typeof Gtk.Assistant>,
  page: InstanceType<typeof Gtk.Widget>,
  node: VioNode,
): void {
  const title = node.props["page-title"];
  const type = node.props["page-type"];
  const complete = node.props.complete;
  if (typeof title === "string") assistant.setPageTitle(page, title);
  if (type !== undefined) assistant.setPageType(page, pageTypeOf(type as string | number));
  if (typeof complete === "boolean") assistant.setPageComplete(page, complete);
}

export const VAssistant = defineComponent({
  name: "VAssistant",
  inheritAttrs: false,
  props: {
    currentPage: { type: Number as PropType<number | undefined>, default: undefined },
    modelValue: { type: Number as PropType<number | undefined>, default: undefined },
    useHeaderBar: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:currentPage", "update:modelValue"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    const assistant = () => element.value?.widget as InstanceType<typeof Gtk.Assistant> | undefined;
    const current = () => props.currentPage ?? props.modelValue;
    const apply = () => {
      const target = assistant();
      const value = current();
      if (!target || value === undefined) return;
      const count = target.getNPages();
      if (count === 0) return;
      const index = Math.max(0, Math.min(value, count - 1));
      if (target.getCurrentPage() !== index) target.setCurrentPage(index);
    };
    // Gtk.Assistant:current-page has no working getter/property notification on GTK 4.24, so the
    // model is updated from ::prepare, which fires after the current index changed.
    const prepared = () => {
      const target = assistant();
      if (!target) return;
      const next = target.getCurrentPage();
      if (next < 0) return;
      if (current() !== undefined && next !== current()) emit("update:currentPage", next);
      if (props.modelValue !== undefined && next !== props.modelValue)
        emit("update:modelValue", next);
    };
    onMounted(apply);
    watch(current, apply, { flush: "post" });
    expose(handle);
    return () => {
      const preparedHandler = withHandler(attrs, "onPrepare", prepared);
      return h(
        "vio-assistant",
        {
          ...preparedHandler.attrs,
          ref: element,
          ...(props.useHeaderBar === undefined ? {} : { useHeaderBar: props.useHeaderBar }),
          onPrepare: preparedHandler.handlers,
        },
        slots.default?.(),
      );
    };
  },
});

export const VAssistantPage = defineComponent({
  name: "VAssistantPage",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    pageType: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    complete: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { slots, expose }) {
    const element = shallowRef<VioElement | null>(null);
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    const assistant = () =>
      element.value?.parent?.widget as InstanceType<typeof Gtk.Assistant> | null;
    const apply = () => {
      const owner = assistant();
      const page = element.value?.widget as InstanceType<typeof Gtk.Widget> | undefined;
      if (!owner || !page) return;
      if (props.title !== undefined) owner.setPageTitle(page, props.title);
      owner.setPageType(page, pageTypeOf(props.pageType));
      if (props.complete !== undefined) owner.setPageComplete(page, props.complete);
    };
    onMounted(apply);
    watch(() => [props.title, props.pageType, props.complete] as const, apply, { flush: "post" });
    return () =>
      h("box", { role: "page", "slot-container": true, ref: element }, slots.default?.());
  },
});

/* ------------------------------------------------------------------------------------------------
 * Synchronous dialog widgets.
 * ---------------------------------------------------------------------------------------------- */

const dialogContent = (dialog: InstanceType<typeof Gtk.Dialog>) => dialog.getContentArea();

define("vio-dialog", {
  create: () => new Gtk.Dialog(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    if (role !== null && role !== "content")
      throw new Error(`vio: VDialog children must use the default or #content slot`);
    const dialog = parentWidget as InstanceType<typeof Gtk.Dialog>;
    const area = dialogContent(dialog);
    if (child.getParent() !== area) area.append(child);
  },
  removeChild({ parentWidget, child, role, node }) {
    if (role !== null && role !== "content") return;
    const area = dialogContent(parentWidget as InstanceType<typeof Gtk.Dialog>);
    if (child.getParent() === area) area.remove(child);
    releaseSlot(node, child);
  },
});

const dialogButtonCodes = new Map<ResponseId, number>();
let responseCode = 1000;

function codeFor(id: ResponseId): number {
  if (typeof id === "number") return id;
  const existing = dialogButtonCodes.get(id);
  if (existing !== undefined) return existing;
  const code = ++responseCode;
  dialogButtonCodes.set(id, code);
  return code;
}

export const VDialog = defineComponent({
  name: "VDialog",
  inheritAttrs: false,
  props: {
    buttons: { type: Array as PropType<DialogButton[]>, default: () => [] },
    defaultResponse: {
      type: [String, Number] as PropType<ResponseId | undefined>,
      default: undefined,
    },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    modelValue: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["response", "update:visible", "update:modelValue"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    const records = new Map<
      ResponseId,
      { code: number; button: InstanceType<typeof Gtk.Button> }
    >();
    const translations = new Map<number, ResponseId>();
    const dialog = () => element.value?.widget as InstanceType<typeof Gtk.Dialog> | undefined;
    const syncButtons = () => {
      const target = dialog();
      if (!target) return;
      const wanted = new Set(props.buttons.map((spec) => spec.id));
      for (const [id, record] of records) if (!wanted.has(id)) record.button.setVisible(false);
      for (const spec of props.buttons) {
        const code = codeFor(spec.id);
        let record = records.get(spec.id);
        if (!record) {
          const next = {
            code,
            button: buttonOf(target.addButton(spec.label, code)),
          };
          record = next;
          records.set(spec.id, next);
          translations.set(code, spec.id);
        } else if (record.button.getLabel() !== spec.label) record.button.setLabel(spec.label);
        record.button.setVisible(true);
        if (spec.suggested) record.button.addCssClass("suggested-action");
        else record.button.removeCssClass("suggested-action");
        if (spec.default) target.setDefaultResponse(code);
      }
      const current = props.defaultResponse;
      if (current !== undefined) {
        const record = records.get(current);
        if (record) target.setDefaultResponse(record.code);
      }
    };
    const visibleValue = () => props.visible ?? props.modelValue;
    const setVisible = (value: boolean) => {
      const target = dialog();
      if (!target) return;
      if (value) target.present();
      else target.hide();
      if (props.visible !== undefined && props.visible !== value) emit("update:visible", value);
      if (props.modelValue !== undefined && props.modelValue !== value)
        emit("update:modelValue", value);
    };
    onMounted(() => {
      const parent = nativeWindow(props.transientFor);
      const target = dialog();
      if (target && parent) target.setTransientFor(parent);
      if (props.modal !== undefined && target) target.setModal(props.modal);
      syncButtons();
      if (visibleValue()) setVisible(true);
    });
    watch(() => props.buttons, syncButtons, { deep: true, flush: "post" });
    watch(
      () => props.defaultResponse,
      () => {
        const target = dialog();
        const record =
          props.defaultResponse === undefined ? undefined : records.get(props.defaultResponse);
        if (target && record) target.setDefaultResponse(record.code);
      },
      { flush: "post" },
    );
    watch(visibleValue, (value) => setVisible(Boolean(value)), { flush: "post" });
    const response = (...args: unknown[]) => {
      const code = Number(args[0]);
      const id = translations.get(code) ?? code;
      const target = dialog();
      if (target) target.hide();
      if (props.visible !== undefined) emit("update:visible", false);
      if (props.modelValue !== undefined) emit("update:modelValue", false);
      emit("response", id);
      return undefined;
    };
    expose({
      ...handle,
      get buttons() {
        return records;
      },
      button(id: ResponseId) {
        return records.get(id)?.button ?? null;
      },
    });
    return () => {
      const parent = nativeWindow(props.transientFor);
      return h(
        "vio-dialog",
        {
          ...attrs,
          ref: element,
          ...(props.modal === undefined ? {} : { modal: props.modal }),
          ...(parent == null ? {} : { transientFor: parent }),
          onResponse: response,
        },
        slots.content ?? slots.default?.(),
      );
    };
  },
});

define("vio-message-dialog", {
  create: () => new Gtk.MessageDialog(),
  children: "none",
});

export const VMessageDialog = defineComponent({
  name: "VMessageDialog",
  inheritAttrs: false,
  emits: ["response", "close-response"],
  props: {
    messageType: { type: String as PropType<string | undefined>, default: undefined },
    buttons: { type: String as PropType<string | undefined>, default: undefined },
    text: { type: String as PropType<string | undefined>, default: undefined },
    secondaryText: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
  },
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const added = new Map<number, InstanceType<typeof Gtk.Button>>();
    const dialog = () =>
      element.value?.widget as InstanceType<typeof Gtk.MessageDialog> | undefined;
    const syncButtons = () => {
      const target = dialog();
      if (!target) return;
      const specs = messageButtons[props.buttons ?? "none"];
      if (!specs) throw new Error(`vio: unknown message dialog buttons '${props.buttons}'`);
      const wanted = new Set(specs.map((spec) => spec.id));
      for (const [id, button] of added) if (!wanted.has(id)) button.setVisible(false);
      for (const spec of specs) {
        let button = added.get(spec.id);
        if (!button) {
          button = buttonOf(target.addButton(spec.label, spec.id));
          added.set(spec.id, button);
        }
        button.setVisible(true);
      }
      if (wanted.has(Gtk.ResponseType.OK)) target.setDefaultResponse(Gtk.ResponseType.OK);
      else if (wanted.has(Gtk.ResponseType.YES)) target.setDefaultResponse(Gtk.ResponseType.YES);
    };
    const setVisible = (value: boolean) => {
      const target = dialog();
      if (!target) return;
      if (value) target.present();
      else target.hide();
    };
    onMounted(() => {
      const parent = nativeWindow(props.transientFor);
      const target = dialog();
      if (target && parent) target.setTransientFor(parent);
      if (props.modal !== undefined && target) target.setModal(props.modal);
      syncButtons();
      if (props.visible) setVisible(true);
    });
    watch(() => props.buttons, syncButtons, { flush: "post" });
    watch(
      () => props.visible,
      (value) => setVisible(Boolean(value)),
      { flush: "post" },
    );
    const responded = (...args: unknown[]) => {
      const id = Number(args[0]);
      emit("response", id);
      if (id === Gtk.ResponseType.CLOSE || id === Gtk.ResponseType.DELETE_EVENT)
        emit("close-response", id);
      return undefined;
    };
    expose(handle);
    return () => {
      const parent = nativeWindow(props.transientFor);
      const type = props.messageType === undefined ? undefined : messageTypes[props.messageType];
      if (props.messageType !== undefined && type === undefined)
        throw new Error(`vio: unknown message-type '${props.messageType}'`);
      return h("vio-message-dialog", {
        ...attrs,
        ref: element,
        ...(type === undefined ? {} : { messageType: type }),
        ...(props.text === undefined ? {} : { text: props.text }),
        ...(props.secondaryText === undefined ? {} : { secondaryText: props.secondaryText }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(parent == null ? {} : { transientFor: parent }),
        ...(props.visible === undefined ? {} : { visible: props.visible }),
        onResponse: responded,
      });
    };
  },
});

define("vio-file-chooser-dialog", {
  create: () => new Gtk.FileChooserDialog(),
  children: "none",
});

export const VFileChooserDialog = defineComponent({
  name: "VFileChooserDialog",
  inheritAttrs: false,
  props: {
    action: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    filters: { type: Array as PropType<FileFilterInput[]>, default: () => [] },
    currentName: { type: String as PropType<string | undefined>, default: undefined },
    acceptLabel: { type: String as PropType<string | undefined>, default: undefined },
    cancelLabel: { type: String as PropType<string | undefined>, default: undefined },
    selectMultiple: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const filters = new Set<InstanceType<typeof Gtk.FileFilter>>();
    let accept: InstanceType<typeof Gtk.Button> | null = null;
    let cancel: InstanceType<typeof Gtk.Button> | null = null;
    const dialog = () =>
      element.value?.widget as InstanceType<typeof Gtk.FileChooserDialog> | undefined;
    const action = () => chooserActionOf(props.action);
    const defaultLabel = () => {
      const current = action();
      if (current === Gtk.FileChooserAction.SAVE) return "Save";
      if (current === Gtk.FileChooserAction.SELECT_FOLDER) return "Select";
      return "Open";
    };
    const syncFilters = () => {
      const target = dialog();
      if (!target) return;
      for (const filter of filters) target.removeFilter(filter);
      filters.clear();
      for (const filter of toFileFilters(props.filters)) {
        target.addFilter(filter);
        filters.add(filter);
      }
      const first = filters.values().next().value as
        | InstanceType<typeof Gtk.FileFilter>
        | undefined;
      if (first) target.setFilter(first);
    };
    const syncButtons = () => {
      const target = dialog();
      if (!target) return;
      if (!accept)
        accept = buttonOf(
          target.addButton(props.acceptLabel ?? defaultLabel(), Gtk.ResponseType.ACCEPT),
        );
      else accept.setLabel(props.acceptLabel ?? defaultLabel());
      if (!cancel)
        cancel = buttonOf(target.addButton(props.cancelLabel ?? "Cancel", Gtk.ResponseType.CANCEL));
      else cancel.setLabel(props.cancelLabel ?? "Cancel");
      target.setDefaultResponse(Gtk.ResponseType.ACCEPT);
    };
    const syncCurrentName = () => {
      const target = dialog();
      if (!target || props.currentName === undefined) return;
      // GTK asserts when current-name is set on an OPEN dialog (verified on 4.24).
      if (target.getAction() === Gtk.FileChooserAction.SAVE)
        target.setCurrentName(props.currentName);
    };
    const setVisible = (value: boolean) => {
      const target = dialog();
      if (!target) return;
      if (value) target.present();
      else target.hide();
    };
    onMounted(() => {
      const parent = nativeWindow(props.transientFor);
      const target = dialog();
      if (target && parent) target.setTransientFor(parent);
      if (props.modal !== undefined && target) target.setModal(props.modal);
      if (props.selectMultiple !== undefined && target)
        target.setSelectMultiple(props.selectMultiple);
      syncButtons();
      syncFilters();
      syncCurrentName();
      if (props.visible) setVisible(true);
    });
    watch(() => props.filters, syncFilters, { deep: true, flush: "post" });
    watch(
      () => [props.acceptLabel, props.action] as const,
      () => {
        const target = dialog();
        if (target && props.action !== undefined) target.setAction(action());
        if (accept) accept.setLabel(props.acceptLabel ?? defaultLabel());
        syncCurrentName();
      },
      { flush: "post" },
    );
    watch(() => props.currentName, syncCurrentName, { flush: "post" });
    watch(
      () => props.selectMultiple,
      (value) => {
        const target = dialog();
        if (target && value !== undefined) target.setSelectMultiple(value);
      },
      { flush: "post" },
    );
    watch(
      () => props.visible,
      (value) => setVisible(Boolean(value)),
      { flush: "post" },
    );
    expose(handle);
    return () => {
      const parent = nativeWindow(props.transientFor);
      return h("vio-file-chooser-dialog", {
        ...attrs,
        ref: element,
        action: action(),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(parent == null ? {} : { transientFor: parent }),
        ...(props.selectMultiple === undefined ? {} : { selectMultiple: props.selectMultiple }),
        ...(props.visible === undefined ? {} : { visible: props.visible }),
      });
    };
  },
});

/** `Gtk.FileChooserNative` is a `Gtk.NativeDialog` (GObject), not a widget: null-rendering controller. */
export const VFileChooserNative = defineComponent({
  name: "VFileChooserNative",
  props: {
    action: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    acceptLabel: { type: String as PropType<string | undefined>, default: undefined },
    cancelLabel: { type: String as PropType<string | undefined>, default: undefined },
    currentName: { type: String as PropType<string | undefined>, default: undefined },
    selectMultiple: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    filters: { type: Array as PropType<FileFilterInput[]>, default: () => [] },
  },
  emits: ["response"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(
      new Gtk.FileChooserNative({
        title: props.title,
        action: chooserActionOf(props.action),
      }),
    );
    const filters = new Set<InstanceType<typeof Gtk.FileFilter>>();
    const response = (...args: unknown[]) => {
      emit("response", Number(args[0]));
      return undefined;
    };
    dialog.on("response", response);
    const syncFilters = () => {
      for (const filter of filters) dialog.removeFilter(filter);
      filters.clear();
      for (const filter of toFileFilters(props.filters)) {
        dialog.addFilter(filter);
        filters.add(filter);
      }
      const first = filters.values().next().value as
        | InstanceType<typeof Gtk.FileFilter>
        | undefined;
      if (first) dialog.setFilter(first);
    };
    const sync = () => {
      dialog.setTitle(clearable(props.title));
      dialog.setAction(chooserActionOf(props.action));
      if (props.acceptLabel !== undefined) dialog.setAcceptLabel(props.acceptLabel);
      if (props.cancelLabel !== undefined) dialog.setCancelLabel(props.cancelLabel);
      if (props.modal !== undefined) dialog.setModal(props.modal);
      if (props.selectMultiple !== undefined) dialog.setSelectMultiple(props.selectMultiple);
      if (props.currentName !== undefined && dialog.getAction() === Gtk.FileChooserAction.SAVE)
        dialog.setCurrentName(props.currentName);
      syncFilters();
    };
    sync();
    watch(
      () =>
        [
          props.action,
          props.title,
          props.modal,
          props.acceptLabel,
          props.cancelLabel,
          props.currentName,
          props.selectMultiple,
          props.filters,
        ] as const,
      sync,
      { deep: true, flush: "post" },
    );
    onUnmounted(() => {
      dialog.off("response", response);
      dialog.destroy();
    });
    expose({
      native: dialog,
      get widget() {
        return dialog;
      },
      show(parent?: unknown) {
        const window = nativeWindow(parent);
        if (window) dialog.setTransientFor(window);
        dialog.show();
      },
      hide() {
        dialog.hide();
      },
      destroy() {
        dialog.destroy();
      },
      get visible() {
        return dialog.getVisible();
      },
    });
    return () => null;
  },
});

const chooserDialogBase = {
  title: { type: String as PropType<string | undefined>, default: undefined },
  modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  transientFor: { type: Object as PropType<unknown>, default: null },
  acceptLabel: { type: String as PropType<string | undefined>, default: undefined },
  cancelLabel: { type: String as PropType<string | undefined>, default: undefined },
};

function useChooserButtons(
  dialog: () => InstanceType<typeof Gtk.Dialog> | undefined,
  labels: () => { accept: string; cancel: string },
) {
  let accept: InstanceType<typeof Gtk.Button> | null = null;
  let cancel: InstanceType<typeof Gtk.Button> | null = null;
  const sync = () => {
    const target = dialog();
    if (!target) return;
    const wanted = labels();
    if (!accept) accept = buttonOf(target.addButton(wanted.accept, Gtk.ResponseType.OK));
    else accept.setLabel(wanted.accept);
    if (!cancel) cancel = buttonOf(target.addButton(wanted.cancel, Gtk.ResponseType.CANCEL));
    else cancel.setLabel(wanted.cancel);
    target.setDefaultResponse(Gtk.ResponseType.OK);
  };
  return {
    sync,
    get accept() {
      return accept;
    },
    get cancel() {
      return cancel;
    },
  };
}

define("vio-color-chooser-dialog", {
  create: () => new Gtk.ColorChooserDialog(),
  children: "none",
});

export const VColorChooserDialog = defineComponent({
  name: "VColorChooserDialog",
  inheritAttrs: false,
  props: {
    ...chooserDialogBase,
    rgba: { type: Object as PropType<InstanceType<typeof Gdk.RGBA> | null>, default: null },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const dialog = () =>
      element.value?.widget as InstanceType<typeof Gtk.ColorChooserDialog> | undefined;
    const buttons = useChooserButtons(dialog, () => ({
      accept: props.acceptLabel ?? "Select",
      cancel: props.cancelLabel ?? "Cancel",
    }));
    const syncColor = () => {
      const target = dialog();
      if (target && props.rgba) target.setRgba(props.rgba);
    };
    const setVisible = (value: boolean) => {
      const target = dialog();
      if (!target) return;
      if (value) target.present();
      else target.hide();
    };
    onMounted(() => {
      const parent = nativeWindow(props.transientFor);
      const target = dialog();
      if (target && parent) target.setTransientFor(parent);
      if (props.modal !== undefined && target) target.setModal(props.modal);
      buttons.sync();
      syncColor();
      if (props.visible) setVisible(true);
    });
    watch(() => [props.acceptLabel, props.cancelLabel] as const, buttons.sync, { flush: "post" });
    watch(() => props.rgba, syncColor, { flush: "post" });
    watch(
      () => props.visible,
      (value) => setVisible(Boolean(value)),
      { flush: "post" },
    );
    expose(handle);
    return () => {
      const parent = nativeWindow(props.transientFor);
      return h("vio-color-chooser-dialog", {
        ...attrs,
        ref: element,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(parent == null ? {} : { transientFor: parent }),
        ...(props.visible === undefined ? {} : { visible: props.visible }),
      });
    };
  },
});

define("vio-font-chooser-dialog", {
  create: () => new Gtk.FontChooserDialog(),
  children: "none",
});

export const VFontChooserDialog = defineComponent({
  name: "VFontChooserDialog",
  inheritAttrs: false,
  props: {
    ...chooserDialogBase,
    fontDesc: {
      type: Object as PropType<InstanceType<typeof Pango.FontDescription> | null>,
      default: null,
    },
    level: {
      type: [String, Number, Array] as PropType<number | string | string[] | undefined>,
      default: undefined,
    },
    previewText: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const dialog = () =>
      element.value?.widget as InstanceType<typeof Gtk.FontChooserDialog> | undefined;
    const buttons = useChooserButtons(dialog, () => ({
      accept: props.acceptLabel ?? "Select",
      cancel: props.cancelLabel ?? "Cancel",
    }));
    const syncFont = () => {
      const target = dialog();
      if (!target) return;
      if (props.fontDesc) target.setFontDesc(props.fontDesc);
      const level = fontLevelOf(props.level);
      if (level !== undefined) target.setLevel(level);
      if (props.previewText !== undefined) target.setPreviewText(props.previewText);
    };
    const setVisible = (value: boolean) => {
      const target = dialog();
      if (!target) return;
      if (value) target.present();
      else target.hide();
    };
    onMounted(() => {
      const parent = nativeWindow(props.transientFor);
      const target = dialog();
      if (target && parent) target.setTransientFor(parent);
      if (props.modal !== undefined && target) target.setModal(props.modal);
      buttons.sync();
      syncFont();
      if (props.visible) setVisible(true);
    });
    watch(() => [props.acceptLabel, props.cancelLabel] as const, buttons.sync, { flush: "post" });
    watch(() => [props.fontDesc, props.level, props.previewText] as const, syncFont, {
      flush: "post",
    });
    watch(
      () => props.visible,
      (value) => setVisible(Boolean(value)),
      { flush: "post" },
    );
    expose(handle);
    return () => {
      const parent = nativeWindow(props.transientFor);
      return h("vio-font-chooser-dialog", {
        ...attrs,
        ref: element,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(parent == null ? {} : { transientFor: parent }),
        ...(props.visible === undefined ? {} : { visible: props.visible }),
      });
    };
  },
});

/**
 * `Gtk.AppChooserDialog` has construct-only `content-type` and `gfile`. The native dialog is
 * therefore owned by the component (a null-rendering controller) instead of being an element.
 */
export const VAppChooserDialog = defineComponent({
  name: "VAppChooserDialog",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    contentType: { type: String as PropType<string | undefined>, default: undefined },
    gfile: { type: Object as PropType<NativeFile | null>, default: null },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
  },
  emits: ["response"],
  setup(props, { expose, emit }) {
    const dialog = markRaw(
      new Gtk.AppChooserDialog({
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.contentType === undefined ? {} : { contentType: props.contentType }),
        ...(props.gfile == null ? {} : { gfile: props.gfile }),
      }),
    );
    const response = (...args: unknown[]) => {
      emit("response", Number(args[0]));
      return undefined;
    };
    dialog.on("response", response);
    if (props.modal !== undefined) dialog.setModal(props.modal);
    const setVisible = (value: boolean) => {
      if (value) {
        const parent = nativeWindow(props.transientFor);
        if (parent) dialog.setTransientFor(parent);
        dialog.present();
      } else dialog.hide();
    };
    watch(
      () => props.visible,
      (value) => setVisible(Boolean(value)),
      { immediate: true, flush: "post" },
    );
    onUnmounted(() => {
      dialog.off("response", response);
      dialog.destroy();
    });
    expose({
      dialog,
      get widget() {
        return dialog;
      },
      present() {
        setVisible(true);
      },
      hide() {
        dialog.hide();
      },
    });
    return () => null;
  },
});

define("vio-print-unix-dialog", {
  create: () => new Gtk.PrintUnixDialog(),
  children: "none",
});

export const VPrintUnixDialog = defineComponent({
  name: "VPrintUnixDialog",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    pageSetup: { type: Object as PropType<unknown>, default: null },
    printSettings: { type: Object as PropType<unknown>, default: null },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () =>
      h("vio-print-unix-dialog", {
        ...attrs,
        ref: element,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(isPrivate(props.pageSetup) ? {} : { pageSetup: props.pageSetup }),
        ...(isPrivate(props.printSettings) ? {} : { printSettings: props.printSettings }),
      });
  },
});

define("vio-page-setup-unix-dialog", {
  create: () => new Gtk.PageSetupUnixDialog(),
  children: "none",
});

export const VPageSetupUnixDialog = defineComponent({
  name: "VPageSetupUnixDialog",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    pageSetup: { type: Object as PropType<unknown>, default: null },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () =>
      h("vio-page-setup-unix-dialog", {
        ...attrs,
        ref: element,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(isPrivate(props.pageSetup) ? {} : { pageSetup: props.pageSetup }),
      });
  },
});

define("vio-about-dialog", {
  create: () => new Gtk.AboutDialog(),
  children: "none",
});

export const VAboutDialog = defineComponent({
  name: "VAboutDialog",
  inheritAttrs: false,
  props: {
    authors: { type: Array as PropType<string[]>, default: undefined },
    artists: { type: Array as PropType<string[]>, default: undefined },
    documenters: { type: Array as PropType<string[]>, default: undefined },
    comments: { type: String as PropType<string | undefined>, default: undefined },
    copyright: { type: String as PropType<string | undefined>, default: undefined },
    licenseType: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    version: { type: String as PropType<string | undefined>, default: undefined },
    website: { type: String as PropType<string | undefined>, default: undefined },
    websiteLabel: { type: String as PropType<string | undefined>, default: undefined },
    logo: { type: String as PropType<string | undefined>, default: undefined },
    programName: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () => {
      const license = licenseOf(props.licenseType);
      const link = booleanHandler(attrs, "onActivateLink");
      return h(
        "vio-about-dialog",
        {
          ...link.attrs,
          ref: element,
          onActivateLink: link.handler,
          ...(props.authors === undefined ? {} : { authors: props.authors }),
          ...(props.artists === undefined ? {} : { artists: props.artists }),
          ...(props.documenters === undefined ? {} : { documenters: props.documenters }),
          ...(props.comments === undefined ? {} : { comments: props.comments }),
          ...(props.copyright === undefined ? {} : { copyright: props.copyright }),
          ...(license === undefined ? {} : { licenseType: license }),
          ...(props.version === undefined ? {} : { version: props.version }),
          ...(props.website === undefined ? {} : { website: props.website }),
          ...(props.websiteLabel === undefined ? {} : { websiteLabel: props.websiteLabel }),
          ...(props.logo === undefined ? {} : { logoIconName: props.logo }),
          ...(props.programName === undefined ? {} : { programName: props.programName }),
        },
        slots.default?.(),
      );
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Shared exports.
 * ---------------------------------------------------------------------------------------------- */

export { messageButtons as messageDialogButtons };
