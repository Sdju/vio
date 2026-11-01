import Gtk from "gi:Gtk-4.0";
import { defineComponent, h, shallowRef, type PropType } from "@vue/runtime-core";
import type { VioElement } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";

function define(type: string, definition: WidgetDefinition): WidgetDefinition {
  if (!hasWidget(type)) registerWidget(type, definition);
  const registered = getWidgetDefinition(type);
  if (!registered) throw new Error(`vio: failed to register '${type}'`);
  return registered;
}

function isInside(
  child: InstanceType<typeof Gtk.Widget>,
  ancestor: InstanceType<typeof Gtk.Widget>,
) {
  for (let node = child.getParent(); node; node = node.getParent())
    if (node === ancestor) return true;
  return false;
}

/**
 * `Gtk.ShortcutsWindow.addSection()`, `Gtk.ShortcutsSection.addGroup()` and
 * `Gtk.ShortcutsGroup.addShortcut()` are public methods on public widget classes on GTK 4.24.
 * The `vio-*` types therefore own the placement instead of relying on the generic `single` mode.
 */
define("vio-shortcuts-window", {
  create: () => new Gtk.ShortcutsWindow(),
  children: "none",
  insertChild({ parentWidget, child }) {
    if (!(child instanceof Gtk.ShortcutsSection))
      throw new Error(`vio: VShortcutsWindow children must be VShortcutsSection`);
    const window = parentWidget as InstanceType<typeof Gtk.ShortcutsWindow>;
    if (isInside(child, window)) return;
    if (child.getParent()) child.unparent();
    window.addSection(child);
  },
  removeChild({ parentWidget, child }) {
    if (isInside(child, parentWidget as InstanceType<typeof Gtk.Widget>)) child.unparent();
  },
});

define("vio-shortcuts-section", {
  create: () => new Gtk.ShortcutsSection(),
  children: "none",
  insertChild({ parentWidget, child }) {
    if (!(child instanceof Gtk.ShortcutsGroup))
      throw new Error(`vio: VShortcutsSection children must be VShortcutsGroup`);
    const section = parentWidget as InstanceType<typeof Gtk.ShortcutsSection>;
    if (isInside(child, section)) return;
    if (child.getParent()) child.unparent();
    section.addGroup(child);
  },
  removeChild({ parentWidget, child }) {
    if (isInside(child, parentWidget as InstanceType<typeof Gtk.Widget>)) child.unparent();
  },
});

define("vio-shortcuts-group", {
  create: () => new Gtk.ShortcutsGroup(),
  children: "none",
  insertChild({ parentWidget, child }) {
    if (!(child instanceof Gtk.ShortcutsShortcut))
      throw new Error(`vio: VShortcutsGroup children must be VShortcutsShortcut`);
    const group = parentWidget as InstanceType<typeof Gtk.ShortcutsGroup>;
    if (isInside(child, group)) return;
    if (child.getParent()) child.unparent();
    group.addShortcut(child);
  },
  removeChild({ parentWidget, child }) {
    if (isInside(child, parentWidget as InstanceType<typeof Gtk.Widget>)) child.unparent();
  },
});

define("vio-shortcuts-shortcut", {
  create: () => new Gtk.ShortcutsShortcut(),
  children: "none",
});

export const VShortcutsWindow = defineComponent({
  name: "VShortcutsWindow",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    sectionName: { type: String as PropType<string | undefined>, default: undefined },
    viewName: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    transientFor: { type: Object as PropType<unknown>, default: null },
  },
  setup(props, { attrs, slots, expose }) {
    const element = shallowRef<VioElement | null>(null);
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    return () =>
      h(
        "vio-shortcuts-window",
        {
          ...attrs,
          ref: element,
          ...(props.title === undefined ? {} : { title: props.title }),
          ...(props.sectionName === undefined ? {} : { sectionName: props.sectionName }),
          ...(props.viewName === undefined ? {} : { viewName: props.viewName }),
          ...(props.modal === undefined ? {} : { modal: props.modal }),
          ...(props.visible === undefined ? {} : { visible: props.visible }),
          ...(props.transientFor == null ? {} : { transientFor: props.transientFor }),
        },
        slots.default?.(),
      );
  },
});

export const VShortcutsSection = defineComponent({
  name: "VShortcutsSection",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    sectionName: { type: String as PropType<string | undefined>, default: undefined },
    viewName: { type: String as PropType<string | undefined>, default: undefined },
    maxHeight: { type: Number as PropType<number | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const element = shallowRef<VioElement | null>(null);
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    return () =>
      h(
        "vio-shortcuts-section",
        {
          ...attrs,
          ref: element,
          ...(props.title === undefined ? {} : { title: props.title }),
          ...(props.sectionName === undefined ? {} : { sectionName: props.sectionName }),
          ...(props.viewName === undefined ? {} : { viewName: props.viewName }),
          ...(props.maxHeight === undefined ? {} : { maxHeight: props.maxHeight }),
        },
        slots.default?.(),
      );
  },
});

export const VShortcutsGroup = defineComponent({
  name: "VShortcutsGroup",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    view: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const element = shallowRef<VioElement | null>(null);
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    return () =>
      h(
        "vio-shortcuts-group",
        {
          ...attrs,
          ref: element,
          ...(props.title === undefined ? {} : { title: props.title }),
          ...(props.view === undefined ? {} : { view: props.view }),
        },
        slots.default?.(),
      );
  },
});

export const VShortcutsShortcut = defineComponent({
  name: "VShortcutsShortcut",
  inheritAttrs: false,
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    subtitle: { type: String as PropType<string | undefined>, default: undefined },
    accelerator: { type: String as PropType<string | undefined>, default: undefined },
    icon: { type: String as PropType<string | undefined>, default: undefined },
    actionName: { type: String as PropType<string | undefined>, default: undefined },
    direction: { type: Number as PropType<number | undefined>, default: undefined },
    shortcutType: { type: Number as PropType<number | undefined>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const element = shallowRef<VioElement | null>(null);
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    return () =>
      h("vio-shortcuts-shortcut", {
        ...attrs,
        ref: element,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.subtitle === undefined ? {} : { subtitle: props.subtitle }),
        ...(props.accelerator === undefined ? {} : { accelerator: props.accelerator }),
        ...(props.icon === undefined ? {} : { icon: props.icon }),
        ...(props.actionName === undefined ? {} : { actionName: props.actionName }),
        ...(props.direction === undefined ? {} : { direction: props.direction }),
        ...(props.shortcutType === undefined ? {} : { shortcutType: props.shortcutType }),
      });
  },
});
