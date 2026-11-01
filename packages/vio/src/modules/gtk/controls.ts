import Gtk from "gi:Gtk-4.0";
import {
  defineComponent,
  h,
  onMounted,
  shallowRef,
  watch,
  type PropType,
  type VNodeChild,
} from "@vue/runtime-core";
import type { VioElement, VioNode } from "../renderer/index.ts";
import { hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";

type Attrs = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;

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

function releaseSlot(node: VioNode, widget: InstanceType<typeof Gtk.Widget>): void {
  if (node.props["slot-container"] !== true || !(widget instanceof Gtk.Box)) return;
  for (let child = widget.getFirstChild(); child; child = widget.getFirstChild())
    widget.remove(child);
}

/**
 * `Gtk.MenuButton.setChild()` installs the button content, while `setPopover()` installs the
 * popup. They are different slots, so the default child and `#popover` are routed explicitly.
 */
const menuButtonDefinition: WidgetDefinition = {
  create: () => new Gtk.MenuButton(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const button = parentWidget as InstanceType<typeof Gtk.MenuButton>;
    if (role === "popover") {
      if (!(child instanceof Gtk.Popover))
        throw new Error(`vio: VMenuButton #popover must contain a Gtk.Popover`);
      if (button.getPopover() !== child) button.setPopover(child);
      return;
    }
    if (role !== null && role !== "button")
      throw new Error(`vio: VMenuButton children must use the default or #popover slot`);
    const current = button.getChild();
    if (current && current !== child)
      throw new Error(
        `vio: VMenuButton accepts one default widget child; use #popover for the popup`,
      );
    if (current !== child) button.setChild(child);
  },
  removeChild({ parentWidget, child, role, node }) {
    const button = parentWidget as InstanceType<typeof Gtk.MenuButton>;
    if (role === "popover") {
      if (button.getPopover() === child) button.setPopover(null);
      releaseSlot(node, child);
      return;
    }
    if (button.getChild() === child) button.setChild(null);
  },
};

/**
 * `Gtk.Expander` has two independent slots: `setChild()` for the content and
 * `setLabelWidget()` for the header. `#label` is routed to the latter.
 */
const expanderDefinition: WidgetDefinition = {
  create: () => new Gtk.Expander(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const expander = parentWidget as InstanceType<typeof Gtk.Expander>;
    if (role === "label") {
      if (expander.getLabelWidget() !== child) expander.setLabelWidget(child);
      return;
    }
    if (role !== null && role !== "content")
      throw new Error(`vio: VExpander children must use the default or #label slot`);
    const current = expander.getChild();
    if (current && current !== child)
      throw new Error(`vio: VExpander accepts one default widget child; use #label for the header`);
    if (current !== child) expander.setChild(child);
  },
  removeChild({ parentWidget, child, role, node }) {
    const expander = parentWidget as InstanceType<typeof Gtk.Expander>;
    if (role === "label") {
      if (expander.getLabelWidget() === child) expander.setLabelWidget(null);
      releaseSlot(node, child);
      return;
    }
    if (expander.getChild() === child) expander.setChild(null);
  },
};

if (!hasWidget("menu-button")) registerWidget("menu-button", menuButtonDefinition);
if (!hasWidget("expander")) registerWidget("expander", expanderDefinition);

export const VToggleButton = defineComponent({
  name: "VToggleButton",
  inheritAttrs: false,
  props: {
    active: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    modelValue: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    group: { type: Object as PropType<object | null>, default: null },
  },
  emits: ["update:active", "update:modelValue"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const toggled = () => {
      const button = element.value?.widget as InstanceType<typeof Gtk.ToggleButton> | undefined;
      if (!button) return;
      const next = button.getActive();
      if (props.active !== undefined && next !== props.active) emit("update:active", next);
      if (props.modelValue !== undefined && next !== props.modelValue)
        emit("update:modelValue", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onToggled", toggled);
      const value = props.active ?? props.modelValue;
      const content = slots.default?.() ?? slots.group?.();
      return h(
        "toggle-button",
        {
          ...rest,
          ref: element,
          ...(value === undefined ? {} : { active: value }),
          ...(props.group == null ? {} : { group: props.group }),
          onToggled: handlers,
        },
        content,
      );
    };
  },
});

export const VLinkButton = defineComponent({
  name: "VLinkButton",
  inheritAttrs: false,
  props: { uri: { type: String, required: true } },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () => h("link-button", { ...attrs, ref: element, uri: props.uri }, slots.default?.());
  },
});

export const VMenuButton = defineComponent({
  name: "VMenuButton",
  inheritAttrs: false,
  props: { popover: { type: Object as PropType<object | null>, default: null } },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () => {
      const content = slots.default?.();
      const popover = slots.popover
        ? h("popover", { key: "popover", role: "popover" }, slots.popover())
        : null;
      return h(
        "menu-button",
        {
          ...attrs,
          ref: element,
          ...(props.popover == null ? {} : { popover: props.popover }),
        },
        [content, popover],
      );
    };
  },
});

export const VPopover = defineComponent({
  name: "VPopover",
  inheritAttrs: false,
  props: {
    relativeTo: { type: Object as PropType<object | null>, default: null },
    pointingTo: { type: Object as PropType<object | null>, default: null },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () =>
      h(
        "popover",
        {
          ...attrs,
          ref: element,
          ...(props.relativeTo == null ? {} : { relativeTo: props.relativeTo }),
          ...(props.pointingTo == null ? {} : { pointingTo: props.pointingTo }),
        },
        slots.default?.(),
      );
  },
});

export const VPopoverMenu = defineComponent({
  name: "VPopoverMenu",
  inheritAttrs: false,
  props: { menuModel: { type: Object as PropType<object | null>, default: null } },
  setup(props, { attrs, slots, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () =>
      h("popover-menu", { ...attrs, ref: element, menuModel: props.menuModel }, slots.default?.());
  },
});

export const VPopoverMenuBar = defineComponent({
  name: "VPopoverMenuBar",
  inheritAttrs: false,
  props: { menuModel: { type: Object as PropType<object | null>, default: null } },
  setup(props, { attrs, expose }) {
    const { element, handle } = useElement();
    expose(handle);
    return () => h("popover-menu-bar", { ...attrs, ref: element, menuModel: props.menuModel });
  },
});

export const VExpander = defineComponent({
  name: "VExpander",
  inheritAttrs: false,
  props: {
    expanded: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    label: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ["update:expanded"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const changed = () => {
      const expander = element.value?.widget as InstanceType<typeof Gtk.Expander> | undefined;
      if (!expander || props.expanded === undefined) return;
      const next = expander.getExpanded();
      if (next !== props.expanded) emit("update:expanded", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::expanded", changed);
      const label = slots.label
        ? h("box", { key: "label", role: "label", "slot-container": true }, slots.label())
        : null;
      const content: VNodeChild = slots.default?.();
      return h(
        "expander",
        {
          ...rest,
          ref: element,
          ...(props.expanded === undefined ? {} : { expanded: props.expanded }),
          ...(props.label === undefined || slots.label ? {} : { label: props.label }),
          "onNotify::expanded": handlers,
        },
        [content, label],
      );
    };
  },
});

export const VProgressBar = defineComponent({
  name: "VProgressBar",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    text: { type: String as PropType<string | undefined>, default: undefined },
    showText: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:value", "update:text"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const fractionChanged = () => {
      const bar = element.value?.widget as InstanceType<typeof Gtk.ProgressBar> | undefined;
      if (!bar) return;
      const next = bar.getFraction();
      if (next !== props.value) emit("update:value", next);
    };
    const textChanged = () => {
      const bar = element.value?.widget as InstanceType<typeof Gtk.ProgressBar> | undefined;
      if (!bar || props.text === undefined) return;
      const next = bar.getText() ?? "";
      if (next !== props.text) emit("update:text", next);
    };
    return () => {
      const fraction = withHandler(attrs, "onNotify::fraction", fractionChanged);
      const text = withHandler(fraction.attrs, "onNotify::text", textChanged);
      return h("progress-bar", {
        ...text.attrs,
        ref: element,
        fraction: props.value,
        ...(props.text === undefined ? {} : { text: props.text }),
        ...(props.showText === undefined ? {} : { showText: props.showText }),
        "onNotify::fraction": fraction.handlers,
        "onNotify::text": text.handlers,
      });
    };
  },
});

const levelBarModes: Record<string, number> = {
  continuous: Gtk.LevelBarMode.CONTINUOUS,
  discrete: Gtk.LevelBarMode.DISCRETE,
};

export const VLevelBar = defineComponent({
  name: "VLevelBar",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    mode: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ["update:value"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const changed = () => {
      const bar = element.value?.widget as InstanceType<typeof Gtk.LevelBar> | undefined;
      if (!bar) return;
      const next = bar.getValue();
      if (next !== props.value) emit("update:value", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::value", changed);
      const mode = props.mode == null ? undefined : levelBarModes[props.mode];
      if (props.mode != null && mode === undefined)
        throw new Error(`vio: unknown VLevelBar mode '${props.mode}'`);
      return h("level-bar", {
        ...rest,
        ref: element,
        value: props.value,
        ...(mode === undefined ? {} : { mode }),
        "onNotify::value": handlers,
      });
    };
  },
});

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

export const VScale = defineComponent({
  name: "VScale",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    drawValue: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:value"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const adjustment = adjustmentFor(props.value, props.min, props.max, props.step);
    watch(
      () => [props.min, props.max, props.step] as const,
      ([min, max, step]) => syncAdjustment(adjustment, min, max, step),
    );
    watch(
      () => props.value,
      (value) => {
        if (adjustment.getValue() !== value) adjustment.setValue(value);
      },
    );
    const changed = () => {
      const scale = element.value?.widget as InstanceType<typeof Gtk.Scale> | undefined;
      if (!scale) return;
      const next = scale.getValue();
      if (next !== props.value) emit("update:value", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onValueChanged", changed);
      return h("scale", {
        ...rest,
        ref: element,
        adjustment,
        ...(props.drawValue === undefined ? {} : { drawValue: props.drawValue }),
        onValueChanged: handlers,
      });
    };
  },
});

export const VSpinButton = defineComponent({
  name: "VSpinButton",
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    digits: { type: Number, default: 0 },
  },
  emits: ["update:value"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const adjustment = adjustmentFor(props.value, props.min, props.max, props.step);
    watch(
      () => [props.min, props.max, props.step] as const,
      ([min, max, step]) => syncAdjustment(adjustment, min, max, step),
    );
    const changed = () => {
      const button = element.value?.widget as InstanceType<typeof Gtk.SpinButton> | undefined;
      if (!button) return;
      const next = button.getValue();
      if (next !== props.value) emit("update:value", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::value", changed);
      return h("spin-button", {
        ...rest,
        ref: element,
        adjustment,
        value: props.value,
        digits: props.digits,
        "onNotify::value": handlers,
      });
    };
  },
});

export const VDropDown = defineComponent({
  name: "VDropDown",
  inheritAttrs: false,
  props: {
    model: { type: Object as PropType<object | null>, default: null },
    modelValue: { type: Number as PropType<number | undefined>, default: undefined },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const changed = () => {
      const dropDown = element.value?.widget as InstanceType<typeof Gtk.DropDown> | undefined;
      if (!dropDown) return;
      const selected = dropDown.getSelected();
      const next = selected === Gtk.INVALID_LIST_POSITION ? -1 : selected;
      if (props.modelValue !== undefined && next !== props.modelValue)
        emit("update:modelValue", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::selected", changed);
      return h("drop-down", {
        ...rest,
        ref: element,
        model: props.model,
        ...(props.modelValue === undefined ? {} : { selected: props.modelValue }),
        "onNotify::selected": handlers,
      });
    };
  },
});

export const VComboBoxText = defineComponent({
  name: "VComboBoxText",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    items: { type: Array as PropType<string[]>, default: () => [] },
  },
  emits: ["update:text"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    let syncing = false;
    const syncItems = () => {
      const combo = element.value?.widget as InstanceType<typeof Gtk.ComboBoxText> | undefined;
      if (!combo) return;
      syncing = true;
      try {
        combo.removeAll();
        // The string item is both the id and the label, so `v-model:text` matches the display text.
        for (const item of props.items) combo.append(item, item);
        if (props.text !== undefined) combo.setActiveId(props.text);
      } finally {
        syncing = false;
      }
    };
    onMounted(syncItems);
    watch(() => props.items, syncItems, { deep: true });
    const changed = () => {
      if (syncing) return;
      const combo = element.value?.widget as InstanceType<typeof Gtk.ComboBoxText> | undefined;
      if (!combo || props.text === undefined) return;
      const next = combo.getActiveId() ?? "";
      if (next !== props.text) emit("update:text", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onChanged", changed);
      return h("combo-box-text", {
        ...rest,
        ref: element,
        ...(props.text === undefined ? {} : { activeId: props.text }),
        onChanged: handlers,
      });
    };
  },
});

export const VPasswordEntry = defineComponent({
  name: "VPasswordEntry",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    showPeekIcon: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:text"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    expose(handle);
    const changed = () => {
      const entry = element.value?.widget as InstanceType<typeof Gtk.PasswordEntry> | undefined;
      if (!entry || props.text === undefined) return;
      const next = entry.getText();
      if (next !== props.text) emit("update:text", next);
    };
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::text", changed);
      return h("password-entry", {
        ...rest,
        ref: element,
        ...(props.text === undefined ? {} : { text: props.text }),
        ...(props.showPeekIcon === undefined ? {} : { showPeekIcon: props.showPeekIcon }),
        "onNotify::text": handlers,
      });
    };
  },
});

function defineStackBinder(name: "VStackSwitcher" | "VStackSidebar", type: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { stack: { type: Object as PropType<object | null>, default: null } },
    setup(props, { attrs, expose }) {
      if (!props.stack) throw new Error(`vio: '${name}' requires a stack prop`);
      const { element, handle } = useElement();
      expose(handle);
      return () => h(type, { ...attrs, ref: element, stack: props.stack });
    },
  });
}

export const VStackSwitcher = defineStackBinder("VStackSwitcher", "stack-switcher");
export const VStackSidebar = defineStackBinder("VStackSidebar", "stack-sidebar");
