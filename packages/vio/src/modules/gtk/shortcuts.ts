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

function shortcutWidgets(parent: VioElement): Array<InstanceType<typeof Gtk.ShortcutsShortcut>> {
  return parent.children
    .map((node) => node.widget)
    .filter(
      (widget): widget is InstanceType<typeof Gtk.ShortcutsShortcut> =>
        widget instanceof Gtk.ShortcutsShortcut,
    );
}

/** Position among `GtkShortcutsShortcut` children, ignoring the group's internal title label. */
function shortcutIndex(
  group: InstanceType<typeof Gtk.ShortcutsGroup>,
  child: InstanceType<typeof Gtk.ShortcutsShortcut>,
): number {
  let index = 0;
  for (let node = group.getFirstChild(); node; node = node.getNextSibling()) {
    if (!(node instanceof Gtk.ShortcutsShortcut)) continue;
    if (node === child) return index;
    index++;
  }
  return -1;
}

/**
 * The last internal child before the first shortcut row. GTK places the group's title label there;
 * a keyed move to position 0 must insert after it, not before it.
 */
function groupInternalTail(
  group: InstanceType<typeof Gtk.ShortcutsGroup>,
): InstanceType<typeof Gtk.Widget> | null {
  let tail: InstanceType<typeof Gtk.Widget> | null = null;
  for (let node = group.getFirstChild(); node; node = node.getNextSibling()) {
    if (node instanceof Gtk.ShortcutsShortcut) break;
    tail = node;
  }
  return tail;
}

/**
 * `Gtk.ShortcutsWindow.addSection()`, `Gtk.ShortcutsSection.addGroup()` and
 * `Gtk.ShortcutsGroup.addShortcut()` are public methods on public widget classes on GTK 4.24.
 * The `vio-*` types therefore own the placement instead of relying on the generic `single` mode.
 *
 * Shortcut rows are direct children of the `Gtk.ShortcutsGroup` box, so a keyed move is a plain
 * `reorderChildAfter()` / `insertChildAfter()`. Sections live in an internal `Gtk.Stack` and groups
 * are distributed by GTK into column boxes; neither exposes a keyed reorder primitive, so those two
 * levels stay append-only.
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
  insertChild({ parentWidget, child, parent }) {
    if (!(child instanceof Gtk.ShortcutsShortcut))
      throw new Error(`vio: VShortcutsGroup children must be VShortcutsShortcut`);
    const group = parentWidget as InstanceType<typeof Gtk.ShortcutsGroup>;
    const desired = shortcutWidgets(parent);
    if (!desired.includes(child)) desired.push(child);
    const position = desired.indexOf(child);
    if (shortcutIndex(group, child) === position) return;
    const anchor = position > 0 ? desired[position - 1]! : groupInternalTail(group);
    if (child.getParent() === group) {
      group.reorderChildAfter(child, anchor);
      return;
    }
    if (child.getParent()) child.unparent();
    group.insertChildAfter(child, anchor);
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
