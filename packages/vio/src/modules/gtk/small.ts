import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import Pango from "gi:Pango-1.0";
import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
  type PropType,
} from "@vue/runtime-core";
import type { VioElement } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";
import { releaseSlot } from "./containers.ts";

type Attrs = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;
type NativeWidget = InstanceType<typeof Gtk.Widget>;
type SvgWidget = InstanceType<typeof Gtk.SvgWidget>;

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
  const extra = user == null ? [] : Array.isArray(user) ? (user as Handler[]) : [user as Handler];
  return { attrs: rest, handlers: [handler, ...extra] as Handler[] };
}

function define(type: string, definition: WidgetDefinition): WidgetDefinition {
  if (!hasWidget(type)) registerWidget(type, definition);
  const registered = getWidgetDefinition(type);
  if (!registered) throw new Error(`vio: failed to register '${type}'`);
  return registered;
}

function adjustmentFor(
  value: number,
  min: number,
  max: number,
  step: number,
): InstanceType<typeof Gtk.Adjustment> {
  return new Gtk.Adjustment({
    lower: min,
    upper: max,
    value,
    stepIncrement: step,
    pageIncrement: step * 10,
  });
}

function syncAdjustment(
  adjustment: InstanceType<typeof Gtk.Adjustment>,
  min: number,
  max: number,
  step: number,
): void {
  adjustment.setLower(min);
  adjustment.setUpper(max);
  adjustment.setStepIncrement(step);
  adjustment.setPageIncrement(step * 10);
}

const orientations: Record<string, number> = {
  horizontal: Gtk.Orientation.HORIZONTAL,
  vertical: Gtk.Orientation.VERTICAL,
};

function orientationOf(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const orientation = orientations[value];
  if (orientation === undefined) throw new Error(`vio: unknown orientation '${value}'`);
  return orientation;
}

const transitionTypes: Record<string, number> = {
  none: Gtk.RevealerTransitionType.NONE,
  crossfade: Gtk.RevealerTransitionType.CROSSFADE,
  "slide-right": Gtk.RevealerTransitionType.SLIDE_RIGHT,
  "slide-left": Gtk.RevealerTransitionType.SLIDE_LEFT,
  "slide-up": Gtk.RevealerTransitionType.SLIDE_UP,
  "slide-down": Gtk.RevealerTransitionType.SLIDE_DOWN,
  "swing-right": Gtk.RevealerTransitionType.SWING_RIGHT,
  "swing-left": Gtk.RevealerTransitionType.SWING_LEFT,
  "swing-up": Gtk.RevealerTransitionType.SWING_UP,
  "swing-down": Gtk.RevealerTransitionType.SWING_DOWN,
};

function transitionOf(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const transition = transitionTypes[value];
  if (transition === undefined) throw new Error(`vio: unknown revealer transition '${value}'`);
  return transition;
}

function bytesOf(value: unknown): InstanceType<typeof GLib.Bytes> | null {
  if (value == null) return null;
  if (value instanceof GLib.Bytes) return value;
  if (Array.isArray(value)) return GLib.Bytes.new(value as number[]);
  if (value instanceof Uint8Array) return GLib.Bytes.new(Array.from(value));
  return null;
}

function readFileBytes(source: unknown): {
  bytes?: InstanceType<typeof GLib.Bytes>;
  error?: string;
} {
  if (source == null) return {};
  try {
    if (typeof source === "string") {
      const file = source.includes("://")
        ? Gio.File.newForUri(source)
        : Gio.File.newForPath(source);
      if (!file.queryExists(null)) return { error: `svg file not found: ${source}` };
      const [ok, data] = file.loadContents(null);
      if (!ok) return { error: `svg file is unreadable: ${source}` };
      return { bytes: GLib.Bytes.new(data) };
    }
    const candidate = source as { loadContents?: unknown; getPath?: unknown; getUri?: unknown };
    if (typeof candidate.loadContents === "function") {
      const [ok, data] = (
        candidate.loadContents as (cancellable: null) => [boolean, number[]]
      ).call(source, null);
      if (!ok) return { error: "svg file is unreadable" };
      return { bytes: GLib.Bytes.new(data) };
    }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
  return { error: "unsupported svg source; use filename, file or bytes" };
}

/* ------------------------------------------------------------------------------------------------
 * Frames and viewports.
 * ---------------------------------------------------------------------------------------------- */

/** `Gtk.Frame` has a `label-widget` slot next to its single content child. */
define("vio-frame", {
  create: () => new Gtk.Frame(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const frame = parentWidget as InstanceType<typeof Gtk.Frame>;
    if (role === "label-widget") {
      if (frame.getLabelWidget() !== child) frame.setLabelWidget(child);
      return;
    }
    if (role !== null && role !== "content")
      throw new Error("vio: VFrame children must use the default or #label-widget slot");
    const current = frame.getChild();
    if (current && current !== child)
      throw new Error("vio: VFrame accepts one widget child; wrap siblings in VBox");
    if (current !== child) frame.setChild(child);
  },
  removeChild({ parentWidget, child, role, node }) {
    const frame = parentWidget as InstanceType<typeof Gtk.Frame>;
    if (role === "label-widget") {
      if (frame.getLabelWidget() === child) frame.setLabelWidget(null);
      releaseSlot(node, child);
      return;
    }
    if (frame.getChild() === child) frame.setChild(null);
  },
});

export const VFrame = defineComponent({
  name: "VFrame",
  inheritAttrs: false,
  props: {
    label: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get label() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.Frame> | undefined)?.getLabel() ?? null
        );
      },
      get labelWidget() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.Frame> | undefined)?.getLabelWidget() ??
          null
        );
      },
    });
    return () => {
      const labelSlot = slots["label-widget"] ?? slots.labelWidget;
      const labelWidget = labelSlot
        ? h(
            "box",
            { key: "label-widget", role: "label-widget", "slot-container": true },
            labelSlot(),
          )
        : null;
      return h(
        "vio-frame",
        {
          ...attrs,
          ref: element,
          ...(props.label === undefined || labelSlot ? {} : { label: props.label }),
        },
        [slots.default?.(), labelWidget],
      );
    };
  },
});

export const VViewport = defineComponent({
  name: "VViewport",
  inheritAttrs: false,
  props: {
    scrollToFocus: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    const viewport = () => element.value?.widget as InstanceType<typeof Gtk.Viewport> | undefined;
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get scrollToFocus() {
        return viewport()?.getScrollToFocus() ?? false;
      },
      /** GTK 4.24 has no `scroll-to` signal; the method is the only native entry point. */
      scrollTo(descendant: NativeWidget, scroll: object | null = null) {
        viewport()?.scrollTo(descendant, scroll as never);
      },
    });
    return () =>
      h(
        "viewport",
        {
          ...attrs,
          ref: element,
          ...(props.scrollToFocus === undefined ? {} : { scrollToFocus: props.scrollToFocus }),
        },
        slots.default?.(),
      );
  },
});

function aspectFrameDefinition(): WidgetDefinition {
  return {
    create: () => {
      const frame = new Gtk.AspectFrame();
      // `Gtk.AspectFrame` is a bin; an internal box gives it ordinary box-mode children.
      frame.setChild(new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL }));
      return frame;
    },
    children: "none",
    insertChild({ parent, parentWidget, child, node }) {
      const box = (parentWidget as InstanceType<typeof Gtk.AspectFrame>).getChild() as InstanceType<
        typeof Gtk.Box
      >;
      const children = parent.children.filter((item) => item.widget);
      const position = children.indexOf(node);
      const previous =
        position > 0 ? (children[position - 1]!.widget as NativeWidget | null) : null;
      if (child.getParent() === box) box.reorderChildAfter(child, previous);
      else box.insertChildAfter(child, previous);
    },
    removeChild({ parentWidget, child }) {
      const box = (parentWidget as InstanceType<typeof Gtk.AspectFrame>).getChild() as InstanceType<
        typeof Gtk.Box
      >;
      if (box && child.getParent() === box) box.remove(child);
    },
  };
}

define("vio-aspect-frame", aspectFrameDefinition());

export const VAspectFrame = defineComponent({
  name: "VAspectFrame",
  inheritAttrs: false,
  props: {
    ratio: { type: Number as PropType<number | undefined>, default: undefined },
    obeyChild: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    xalign: { type: Number as PropType<number | undefined>, default: undefined },
    yalign: { type: Number as PropType<number | undefined>, default: undefined },
    shrinkChild: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get content() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.AspectFrame> | undefined)?.getChild() ??
          null
        );
      },
    });
    return () => {
      // GTK 4.24 removed `shrink-child`; expanding flags are the closest equivalent.
      const expand =
        props.shrinkChild === undefined
          ? {}
          : props.shrinkChild
            ? { hexpand: false, vexpand: false }
            : { hexpand: true, vexpand: true };
      return h(
        "vio-aspect-frame",
        {
          ...attrs,
          ...expand,
          ref: element,
          ...(props.ratio === undefined ? {} : { ratio: props.ratio }),
          ...(props.obeyChild === undefined ? {} : { obeyChild: props.obeyChild }),
          ...(props.xalign === undefined ? {} : { xalign: props.xalign }),
          ...(props.yalign === undefined ? {} : { yalign: props.yalign }),
        },
        slots.default?.(),
      );
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Revealer.
 * ---------------------------------------------------------------------------------------------- */

export const VRevealer = defineComponent({
  name: "VRevealer",
  inheritAttrs: false,
  props: {
    revealed: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transitionType: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    transitionDuration: { type: Number as PropType<number | undefined>, default: undefined },
  },
  emits: ["update:revealed", "revealed-changed"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    const revealer = () => element.value?.widget as InstanceType<typeof Gtk.Revealer> | undefined;
    let last = props.revealed ?? false;
    watch(
      () => props.revealed,
      (value) => {
        if (value !== undefined) last = value;
      },
    );
    const changed = () => {
      const widget = revealer();
      if (!widget) return;
      const next = widget.getRevealChild();
      if (next === last) return;
      last = next;
      if (props.revealed !== undefined && next !== props.revealed) emit("update:revealed", next);
      emit("revealed-changed", next);
    };
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get revealed() {
        return revealer()?.getRevealChild() ?? false;
      },
      /** True once the transition has finished, not when it was requested. */
      get childRevealed() {
        return revealer()?.getChildRevealed() ?? false;
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::reveal-child", changed);
      return h(
        "revealer",
        {
          ...rest,
          ref: element,
          ...(props.revealed === undefined ? {} : { revealChild: props.revealed }),
          ...(props.transitionType === undefined
            ? {}
            : { transitionType: transitionOf(props.transitionType) }),
          ...(props.transitionDuration === undefined
            ? {}
            : { transitionDuration: props.transitionDuration }),
          "onNotify::reveal-child": handlers,
        },
        slots.default?.(),
      );
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Range-like widgets.
 * ---------------------------------------------------------------------------------------------- */

export const VScrollbar = defineComponent({
  name: "VScrollbar",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    orientation: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: "vertical",
    },
  },
  emits: ["update:value", "value-changed"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const adjustment = adjustmentFor(props.value, props.min, props.max, props.step);
    let applying = false;
    let last = props.value;
    const changed = () => {
      if (applying) return;
      const next = adjustment.getValue();
      if (next === last) return;
      last = next;
      if (next !== props.value) emit("update:value", next);
      emit("value-changed", next);
    };
    adjustment.on("value-changed", changed);
    watch(
      () => [props.min, props.max, props.step] as const,
      ([min, max, step]) => {
        applying = true;
        try {
          syncAdjustment(adjustment, min, max, step);
        } finally {
          applying = false;
        }
      },
    );
    watch(
      () => props.value,
      (value) => {
        last = value;
        if (adjustment.getValue() === value) return;
        applying = true;
        try {
          adjustment.setValue(value);
        } finally {
          applying = false;
        }
      },
    );
    onUnmounted(() => adjustment.off("value-changed", changed));
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      adjustment,
      get value() {
        return adjustment.getValue();
      },
      get min() {
        return adjustment.getLower();
      },
      get max() {
        return adjustment.getUpper();
      },
    });
    return () =>
      h("scrollbar", {
        ...attrs,
        ref: element,
        adjustment,
        orientation: orientationOf(props.orientation),
      });
  },
});

export const VScaleButton = defineComponent({
  name: "VScaleButton",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    icons: { type: Array as PropType<string[] | undefined>, default: undefined },
    adjustment: { type: Object as PropType<object | null>, default: null },
    hasFrame: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
  },
  emits: ["update:value", "value-changed"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const owned = adjustmentFor(props.value, props.min, props.max, props.step);
    const adjustment = (props.adjustment as InstanceType<typeof Gtk.Adjustment> | null) ?? owned;
    let applying = false;
    const button = () => element.value?.widget as InstanceType<typeof Gtk.ScaleButton> | undefined;
    const changed = () => {
      if (applying) return;
      const widget = button();
      if (!widget) return;
      const next = widget.getValue();
      if (next === props.value) return;
      emit("update:value", next);
      emit("value-changed", next);
    };
    watch(
      () => props.value,
      (value) => {
        const widget = button();
        if (!widget || widget.getValue() === value) return;
        applying = true;
        try {
          widget.setValue(value);
        } finally {
          applying = false;
        }
      },
      { flush: "post" },
    );
    watch(
      () => [props.min, props.max, props.step] as const,
      ([min, max, step]) => {
        if (props.adjustment != null) return;
        applying = true;
        try {
          syncAdjustment(owned, min, max, step);
        } finally {
          applying = false;
        }
      },
    );
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get adjustment() {
        return button()?.getAdjustment() ?? adjustment;
      },
      get value() {
        return button()?.getValue() ?? props.value;
      },
      get icons() {
        return button()?.icons ?? [];
      },
      get popover() {
        return button()?.getPopup() ?? null;
      },
      get popoverVisible() {
        return (
          (button()?.getPopup() as InstanceType<typeof Gtk.Popover> | null)?.getVisible() ?? false
        );
      },
      /** GTK has no `GtkScaleButton.popup()` method; the internal popover owns it. */
      popup() {
        const widget = button();
        if (!widget || !widget.getParent()) return false;
        (widget.getPopup() as InstanceType<typeof Gtk.Popover> | null)?.popup();
        return true;
      },
      popdown() {
        (button()?.getPopup() as InstanceType<typeof Gtk.Popover> | null)?.popdown();
      },
    });
    return () => {
      const { attrs: rest } = withHandler(attrs, "onValueChanged", changed);
      return h("scale-button", {
        ...rest,
        ref: element,
        adjustment,
        value: props.value,
        ...(props.icons === undefined ? {} : { icons: [...props.icons] }),
        ...(props.hasFrame === undefined ? {} : { hasFrame: props.hasFrame }),
        onValueChanged: changed,
      });
    };
  },
});

export const VVolumeButton = defineComponent({
  name: "VVolumeButton",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    icons: { type: Array as PropType<string[] | undefined>, default: undefined },
    adjustment: { type: Object as PropType<object | null>, default: null },
    hasFrame: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:value", "value-changed"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    let applying = false;
    const button = () => element.value?.widget as InstanceType<typeof Gtk.VolumeButton> | undefined;
    const changed = () => {
      if (applying) return;
      const widget = button();
      if (!widget) return;
      const next = widget.getValue();
      if (next === props.value) return;
      emit("update:value", next);
      emit("value-changed", next);
    };
    watch(
      () => props.value,
      (value) => {
        const widget = button();
        if (!widget || widget.getValue() === value) return;
        applying = true;
        try {
          widget.setValue(value);
        } finally {
          applying = false;
        }
      },
      { flush: "post" },
    );
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get adjustment() {
        return button()?.getAdjustment() ?? null;
      },
      get value() {
        return button()?.getValue() ?? props.value;
      },
      get icons() {
        return button()?.icons ?? [];
      },
    });
    return () => {
      const { attrs: rest } = withHandler(attrs, "onValueChanged", changed);
      return h("volume-button", {
        ...rest,
        ref: element,
        value: props.value,
        ...(props.icons === undefined ? {} : { icons: [...props.icons] }),
        ...(props.adjustment == null ? {} : { adjustment: props.adjustment }),
        ...(props.hasFrame === undefined ? {} : { hasFrame: props.hasFrame }),
        onValueChanged: changed,
      });
    };
  },
});

export const VLockButton = defineComponent({
  name: "VLockButton",
  inheritAttrs: false,
  props: {
    permission: { type: Object as PropType<object | null>, default: null },
  },
  emits: ["update:permission"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const lock = () => element.value?.widget as InstanceType<typeof Gtk.LockButton> | undefined;
    const changed = () => {
      const widget = lock();
      if (!widget) return;
      const next = widget.getPermission();
      if (next === props.permission) return;
      emit("update:permission", next);
    };
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get permission() {
        return lock()?.getPermission() ?? null;
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::permission", changed);
      return h("lock-button", {
        ...rest,
        ref: element,
        permission: props.permission,
        "onNotify::permission": handlers,
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Popover-hosted widgets.
 * ---------------------------------------------------------------------------------------------- */

define("vio-popover-bin", {
  create: () => new Gtk.PopoverBin(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const bin = parentWidget as InstanceType<typeof Gtk.PopoverBin>;
    if (role === "popover") {
      if (!(child instanceof Gtk.Popover))
        throw new Error("vio: VPopoverBin #popover must contain a Gtk.Popover");
      if (bin.getPopover() !== child) bin.setPopover(child);
      return;
    }
    if (role !== null && role !== "child")
      throw new Error("vio: VPopoverBin children must use the default or #popover slot");
    const current = bin.getChild();
    if (current && current !== child)
      throw new Error(
        "vio: VPopoverBin accepts one default widget child; use #popover for the popup",
      );
    if (current !== child) bin.setChild(child);
  },
  removeChild({ parentWidget, child, role, node }) {
    const bin = parentWidget as InstanceType<typeof Gtk.PopoverBin>;
    if (role === "popover") {
      if (bin.getPopover() === child) bin.setPopover(null);
      releaseSlot(node, child);
      return;
    }
    if (bin.getChild() === child) bin.setChild(null);
  },
});

export const VPopoverBin = defineComponent({
  name: "VPopoverBin",
  inheritAttrs: false,
  props: {
    popover: { type: Object as PropType<object | null>, default: null },
    handleInput: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    menuModel: { type: Object as PropType<object | null>, default: null },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    const bin = () => element.value?.widget as InstanceType<typeof Gtk.PopoverBin> | undefined;
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get child() {
        return bin()?.getChild() ?? null;
      },
      get popover() {
        return bin()?.getPopover() ?? null;
      },
    });
    return () => {
      const popover = slots.popover
        ? h("popover", { key: "popover", role: "popover" }, slots.popover())
        : null;
      return h(
        "vio-popover-bin",
        {
          ...attrs,
          ref: element,
          ...(props.popover == null ? {} : { popover: props.popover }),
          ...(props.handleInput === undefined ? {} : { handleInput: props.handleInput }),
          ...(props.menuModel == null ? {} : { menuModel: props.menuModel }),
        },
        [slots.default?.(), popover],
      );
    };
  },
});

export const VEmojiChooser = defineComponent({
  name: "VEmojiChooser",
  inheritAttrs: false,
  props: {
    relativeTo: { type: Object as PropType<object | null>, default: null },
    pointingTo: { type: Object as PropType<object | null>, default: null },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const chooser = () =>
      element.value?.widget as InstanceType<typeof Gtk.EmojiChooser> | undefined;
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      popup() {
        const widget = chooser();
        if (!widget || !widget.getParent()) return false;
        widget.popup();
        return true;
      },
      popdown() {
        chooser()?.popdown();
      },
      get visible() {
        return chooser()?.getVisible() ?? false;
      },
    });
    return () =>
      h("emoji-chooser", {
        ...attrs,
        ref: element,
        ...(props.relativeTo == null ? {} : { relativeTo: props.relativeTo }),
        ...(props.pointingTo == null ? {} : { pointingTo: props.pointingTo }),
      });
  },
});

/* ------------------------------------------------------------------------------------------------
 * Labels, expanders and SVG.
 * ---------------------------------------------------------------------------------------------- */

export const VShortcutLabel = defineComponent({
  name: "VShortcutLabel",
  inheritAttrs: false,
  props: {
    accelerator: { type: String as PropType<string | undefined>, default: undefined },
    disabledText: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get accelerator() {
        return (
          (element.value?.widget as InstanceType<typeof Gtk.ShortcutLabel> | undefined)
            ?.getAccelerator()
            ?.toString?.() ?? ""
        );
      },
    });
    return () =>
      h("shortcut-label", {
        ...attrs,
        ref: element,
        ...(props.accelerator === undefined ? {} : { accelerator: props.accelerator }),
        ...(props.disabledText === undefined ? {} : { disabledText: props.disabledText }),
      });
  },
});

export const VTreeExpander = defineComponent({
  name: "VTreeExpander",
  inheritAttrs: false,
  props: {
    listRow: { type: Object as PropType<object | null>, default: null },
    indentForIcon: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    indentForDepth: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** GTK 4.24 renamed the property to `indent-for-depth`. */
    indentForExpander: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    hideExpander: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    const expander = () =>
      element.value?.widget as InstanceType<typeof Gtk.TreeExpander> | undefined;
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get item() {
        return expander()?.getItem() ?? null;
      },
      get listRow() {
        return expander()?.getListRow() ?? null;
      },
    });
    return () => {
      const indent = props.indentForDepth ?? props.indentForExpander;
      return h(
        "tree-expander",
        {
          ...attrs,
          ref: element,
          listRow: props.listRow ?? null,
          ...(props.indentForIcon === undefined ? {} : { indentForIcon: props.indentForIcon }),
          ...(indent === undefined ? {} : { indentForDepth: indent }),
          ...(props.hideExpander === undefined ? {} : { hideExpander: props.hideExpander }),
        },
        slots.default?.(),
      );
    };
  },
});

export const VSvgWidget = defineComponent({
  name: "VSvgWidget",
  inheritAttrs: false,
  props: {
    resource: { type: String as PropType<string | undefined>, default: undefined },
    file: { type: [Object, String] as PropType<object | string | null>, default: null },
    filename: { type: String as PropType<string | undefined>, default: undefined },
    bytes: { type: [Object, Array] as PropType<object | number[] | null>, default: null },
    state: { type: Number as PropType<number | undefined>, default: undefined },
    stylesheet: {
      type: [Object, String] as PropType<object | string | undefined>,
      default: undefined,
    },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const error = shallowRef<string | null>(null);
    const svg = () => (element.value?.widget as SvgWidget | undefined)?.svg ?? null;
    const sync = () => {
      const widget = element.value?.widget as SvgWidget | undefined;
      if (!widget) return;
      error.value = null;
      let bytes = bytesOf(props.bytes);
      if (props.bytes != null && !bytes) {
        error.value = "unsupported svg bytes; use GLib.Bytes, Uint8Array or number[]";
        return;
      }
      if (!bytes) {
        const source = props.filename ?? props.file;
        if (source != null) {
          const result = readFileBytes(source);
          if (result.error) {
            error.value = result.error;
            return;
          }
          bytes = result.bytes ?? null;
        }
      }
      if (bytes) {
        try {
          widget.loadFromBytes(bytes);
          // Loading a document resets the state to 0; re-apply an explicit model value.
          if (props.state !== undefined) widget.setState(props.state);
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        }
      }
    };
    onMounted(sync);
    watch(
      () => [props.filename, props.file, props.bytes] as const,
      () => sync(),
      { flush: "post" },
    );
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get svg() {
        return svg();
      },
      /** `GtkSvgWidget` exposes its `GtkSvg` paintables as the read-only `svg` property. */
      get paintable() {
        return svg();
      },
      error,
    });
    return () => {
      const source = props.filename ?? props.file;
      const stylesheet =
        typeof props.stylesheet === "string"
          ? GLib.Bytes.new(Array.from(Buffer.from(props.stylesheet, "utf8")))
          : bytesOf(props.stylesheet);
      return h("svg-widget", {
        ...attrs,
        ref: element,
        ...(props.resource === undefined || source != null || props.bytes != null
          ? {}
          : { resource: props.resource }),
        ...(props.state === undefined ? {} : { state: props.state }),
        ...(stylesheet == null ? {} : { stylesheet }),
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Custom titlebar widgets.
 * ---------------------------------------------------------------------------------------------- */

const packTypes: Record<string, number> = {
  start: Gtk.PackType.START,
  end: Gtk.PackType.END,
};

function packTypeOf(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const pack = packTypes[value];
  if (pack === undefined) throw new Error(`vio: unknown window-controls side '${value}'`);
  return pack;
}

export const VWindowControls = defineComponent({
  name: "VWindowControls",
  inheritAttrs: false,
  props: {
    side: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    decorationLayout: { type: String as PropType<string | undefined>, default: undefined },
    useNativeControls: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** GTK 4.24 removed the property; `false` hides the controls. */
    decorative: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    const controls = () =>
      element.value?.widget as InstanceType<typeof Gtk.WindowControls> | undefined;
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get side() {
        return controls()?.getSide() ?? null;
      },
      get decorationLayout() {
        return controls()?.getDecorationLayout() ?? null;
      },
      get useNativeControls() {
        return controls()?.getUseNativeControls() ?? false;
      },
      get empty() {
        return controls()?.getEmpty() ?? true;
      },
    });
    return () =>
      h("window-controls", {
        ...attrs,
        ref: element,
        ...(props.side === undefined ? {} : { side: packTypeOf(props.side) }),
        ...(props.decorationLayout === undefined
          ? {}
          : { decorationLayout: props.decorationLayout }),
        ...(props.useNativeControls === undefined
          ? {}
          : { useNativeControls: props.useNativeControls }),
        ...(props.decorative !== false ? {} : { visible: false }),
      });
  },
});

export const VWindowHandle = defineComponent({
  name: "VWindowHandle",
  inheritAttrs: false,
  setup(_props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get child() {
        return (
          (
            element.value?.widget as InstanceType<typeof Gtk.WindowHandle> | undefined
          )?.getChild() ?? null
        );
      },
    });
    return () => h("window-handle", { ...attrs, ref: element }, slots.default?.());
  },
});

/* ------------------------------------------------------------------------------------------------
 * Spare widgets: chooser widgets and graphics offload.
 * ---------------------------------------------------------------------------------------------- */

/** A `Gdk.RGBA`, a CSS color string, or an object with r/g/b/a (or red/green/blue/alpha). */
type RgbaInput =
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

function toRgba(value: RgbaInput): InstanceType<typeof Gdk.RGBA> | null {
  if (value == null) return null;
  if (value instanceof Gdk.RGBA) return value;
  const rgba = new Gdk.RGBA();
  if (typeof value === "string") {
    if (!rgba.parse(value)) throw new Error(`vio: invalid rgba string '${value}'`);
    return rgba;
  }
  const source = value;
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
  left: InstanceType<typeof Gdk.RGBA> | null,
  right: InstanceType<typeof Gdk.RGBA> | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.red === right.red &&
    left.green === right.green &&
    left.blue === right.blue &&
    left.alpha === right.alpha
  );
}

/** A Pango font description or its serialized `"Family Style Size"` form. */
type FontInput = string | InstanceType<typeof Pango.FontDescription> | null;

function toFontDescription(value: FontInput): InstanceType<typeof Pango.FontDescription> | null {
  if (value == null) return null;
  if (value instanceof Pango.FontDescription) return value;
  if (typeof value !== "string")
    throw new Error("vio: font must be a string or Pango.FontDescription");
  return Pango.FontDescription.fromString(value);
}

export const VColorChooserWidget = defineComponent({
  name: "VColorChooserWidget",
  inheritAttrs: false,
  props: {
    rgba: { type: [Object, String] as PropType<RgbaInput>, default: null },
    showEditor: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    useAlpha: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:rgba"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const widget = () =>
      element.value?.widget as InstanceType<typeof Gtk.ColorChooserWidget> | undefined;
    let applying = false;
    const apply = () => {
      const chooser = widget();
      if (!chooser) return;
      const next = toRgba(props.rgba);
      if (next == null || sameRgba(next, chooser.getRgba())) return;
      applying = true;
      try {
        chooser.setRgba(next);
      } finally {
        applying = false;
      }
    };
    const changed = (color: unknown) => {
      if (applying) return;
      const next = color instanceof Gdk.RGBA ? color : (widget()?.getRgba() ?? null);
      if (!next || sameRgba(toRgba(props.rgba), next)) return;
      emit("update:rgba", next);
    };
    onMounted(apply);
    watch(() => props.rgba, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get rgba() {
        return widget()?.getRgba() ?? null;
      },
      get useAlpha() {
        return widget()?.getUseAlpha() ?? false;
      },
    });
    return () => {
      toRgba(props.rgba); // validate during render
      const { attrs: rest, handlers } = withHandler(attrs, "onColorActivated", changed);
      return h("color-chooser-widget", {
        ...rest,
        ref: element,
        ...(toRgba(props.rgba) == null ? {} : { rgba: toRgba(props.rgba) }),
        ...(props.showEditor === undefined ? {} : { showEditor: props.showEditor }),
        ...(props.useAlpha === undefined ? {} : { useAlpha: props.useAlpha }),
        onColorActivated: handlers,
      });
    };
  },
});

export const VFontChooserWidget = defineComponent({
  name: "VFontChooserWidget",
  inheritAttrs: false,
  props: {
    font: { type: [Object, String] as PropType<FontInput>, default: null },
    language: { type: String as PropType<string | undefined>, default: undefined },
    level: { type: Number as PropType<number | undefined>, default: undefined },
    previewText: { type: String as PropType<string | undefined>, default: undefined },
    showPreviewEntry: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:font"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const widget = () =>
      element.value?.widget as InstanceType<typeof Gtk.FontChooserWidget> | undefined;
    let applying = false;
    const apply = () => {
      const chooser = widget();
      if (!chooser || props.font == null) return;
      applying = true;
      try {
        if (typeof props.font === "string") chooser.setFont(props.font);
        else {
          const description = toFontDescription(props.font);
          if (description) chooser.setFontDesc(description);
        }
      } finally {
        applying = false;
      }
    };
    const changed = (fontname: unknown) => {
      const name = typeof fontname === "string" ? fontname : String(fontname ?? "");
      if (applying) return;
      const current =
        typeof props.font === "string" ? props.font : (props.font?.toString?.() ?? "");
      if (name === current) return;
      emit("update:font", name);
    };
    onMounted(apply);
    watch(() => props.font, apply, { flush: "post" });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      /** GTK 4.24 leaves this getter empty until the chooser activates a font. */
      get font() {
        return widget()?.getFont() ?? null;
      },
    });
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onFontActivated", changed);
      const description = typeof props.font === "string" ? null : toFontDescription(props.font);
      return h("font-chooser-widget", {
        ...rest,
        ref: element,
        ...(typeof props.font === "string" ? { font: props.font } : {}),
        ...(description == null ? {} : { fontDesc: description }),
        ...(props.language === undefined ? {} : { language: props.language }),
        ...(props.level === undefined ? {} : { level: props.level }),
        ...(props.previewText === undefined ? {} : { previewText: props.previewText }),
        ...(props.showPreviewEntry === undefined
          ? {}
          : { showPreviewEntry: props.showPreviewEntry }),
        onFontActivated: handlers,
      });
    };
  },
});

const offloadStates: Record<string, number> = {
  enabled: Gtk.GraphicsOffloadEnabled.ENABLED,
  disabled: Gtk.GraphicsOffloadEnabled.DISABLED,
};

function offloadStateOf(value: string | boolean | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "boolean")
    return value ? Gtk.GraphicsOffloadEnabled.ENABLED : Gtk.GraphicsOffloadEnabled.DISABLED;
  const state = offloadStates[value];
  if (state === undefined) throw new Error(`vio: unknown GraphicsOffload enabled state '${value}'`);
  return state;
}

export const VGraphicsOffload = defineComponent({
  name: "VGraphicsOffload",
  inheritAttrs: false,
  props: {
    enabled: {
      type: [String, Boolean, Number] as PropType<string | boolean | number | undefined>,
      default: undefined,
    },
    blackBackground: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
    });
    return () =>
      h(
        "graphics-offload",
        {
          ...attrs,
          ref: element,
          ...(props.enabled === undefined ? {} : { enabled: offloadStateOf(props.enabled) }),
          ...(props.blackBackground === undefined
            ? {}
            : { blackBackground: props.blackBackground }),
        },
        slots.default?.(),
      );
  },
});
