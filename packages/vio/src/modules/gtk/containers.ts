import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  Teleport,
  defineComponent,
  h,
  markRaw,
  onMounted,
  shallowRef,
  watch,
  type PropType,
  type ShallowRef,
  type Slot,
  type Slots,
  type VNode,
  type VNodeChild,
} from "@vue/runtime-core";
import { createRoot, type VioElement } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";
import { defineWidgetComponent } from "./components.ts";

/**
 * A GObject handle for a template or setup value.
 *
 * `shallowRef` deliberately never wraps its value in a reactive proxy: node-gtk rejects Vue
 * proxies (`Cannot convert value "[object Object]" ...`). Assign native objects or `null`.
 */
export function useNative<T extends object>(initial: T | null = null): ShallowRef<T | null> {
  return shallowRef<T | null>(initial ? markRaw(initial) : null);
}

export interface DetachedSlot {
  /** Root whose widget owns the teleported subtree; pass `to={target}` to `Teleport`. */
  readonly target: VioElement;
  readonly widget: object | null;
  /** Render the slot into the detached widget, or `null` when the slot is absent. */
  render(slot?: Slot): VNode | null;
}

/**
 * A widget that is not in the parent's child list — for role slots such as a notebook tab label.
 * The component that calls this owns the root; `Teleport` removes its content on unmount.
 */
export function useDetachedSlot(create: () => object = () => new Gtk.Box()): DetachedSlot {
  const target = createRoot(markRaw(create()));
  return {
    target,
    get widget() {
      return target.widget;
    },
    render(slot) {
      if (!slot) return null;
      return h(Teleport, { to: target as unknown as string }, slot()) as VNode;
    },
  };
}

export interface ContainerContext {
  attrs: Record<string, unknown>;
  slots: Slots;
  element: ShallowRef<VioElement | null>;
}

/**
 * A component whose root is one GTK container element. Placement of slot content is described by
 * the widget definition hooks, so the render function only supplies role markers.
 */
export function defineContainerComponent(
  name: string,
  type: string,
  render: (context: ContainerContext) => VNodeChild,
) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots, expose }) {
      const element = shallowRef<VioElement | null>(null);
      expose({
        element,
        get widget() {
          return element.value?.widget ?? null;
        },
      });
      return () => render({ attrs, slots, element });
    },
  });
}

function define(type: string, definition: WidgetDefinition): WidgetDefinition {
  if (!hasWidget(type)) registerWidget(type, definition);
  const registered = getWidgetDefinition(type);
  if (!registered) throw new Error(`vio: failed to register '${type}'`);
  return registered;
}

function isInside(child: object, ancestor: object): boolean {
  let node = (child as InstanceType<typeof Gtk.Widget>).getParent();
  while (node) {
    if (node === ancestor) return true;
    node = node.getParent();
  }
  return false;
}

function flowIndex(flow: InstanceType<typeof Gtk.FlowBox>, child: object): number {
  for (let index = 0; ; index++) {
    const item = flow.getChildAtIndex(index);
    if (!item) return -1;
    if (item.getChild() === child) return index;
  }
}

function flowCount(flow: InstanceType<typeof Gtk.FlowBox>): number {
  let count = 0;
  while (flow.getChildAtIndex(count)) count++;
  return count;
}

/** Static and keyed pages; `VNotebookPage` supplies a GtkBox with `role="page"`. */
define("vio-notebook", {
  create: () => new Gtk.Notebook(),
  children: "none",
  insertChild({ parentWidget, child, node, role, index }) {
    if (role !== "page") throw new Error(`vio: VNotebook children must be VNotebookPage`);
    const notebook = parentWidget as InstanceType<typeof Gtk.Notebook>;
    const label = node.props["tab-label"];
    if (notebook.pageNum(child) === -1)
      notebook.appendPage(child, typeof label === "string" ? new Gtk.Label({ label }) : null);
    const position = Math.max(0, Math.min(index, notebook.getNPages() - 1));
    if (notebook.pageNum(child) !== position) notebook.reorderChild(child, position);
  },
  removeChild({ parentWidget, child, role }) {
    if (role !== "page") return;
    const notebook = parentWidget as InstanceType<typeof Gtk.Notebook>;
    const page = notebook.pageNum(child);
    if (page !== -1) notebook.removePage(page);
  },
});

define("vio-paned", {
  create: () => new Gtk.Paned(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const paned = parentWidget as InstanceType<typeof Gtk.Paned>;
    if (role === "start") {
      if (paned.getStartChild() !== child) paned.setStartChild(child);
    } else if (role === "end") {
      if (paned.getEndChild() !== child) paned.setEndChild(child);
    } else {
      throw new Error(`vio: VPaned children must use the #start or #end slot`);
    }
  },
  removeChild({ parentWidget, child, role }) {
    const paned = parentWidget as InstanceType<typeof Gtk.Paned>;
    if (role === "start" && paned.getStartChild() === child) paned.setStartChild(null);
    else if (role === "end" && paned.getEndChild() === child) paned.setEndChild(null);
  },
});

define("vio-overlay", {
  create: () => new Gtk.Overlay(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const overlay = parentWidget as InstanceType<typeof Gtk.Overlay>;
    if (role === "overlay") {
      if (!isInside(child, overlay)) overlay.addOverlay(child);
    } else if (role === "main" || role === null) {
      if (overlay.getChild() !== child) overlay.setChild(child);
    } else {
      throw new Error(`vio: VOverlay children must use role 'main' or 'overlay'`);
    }
  },
  removeChild({ parentWidget, child, role }) {
    const overlay = parentWidget as InstanceType<typeof Gtk.Overlay>;
    if ((role === "main" || role === null) && overlay.getChild() === child) overlay.setChild(null);
    else if (role === "overlay" && isInside(child, overlay)) overlay.removeOverlay(child);
  },
});

define("vio-center-box", {
  create: () => new Gtk.CenterBox(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const box = parentWidget as InstanceType<typeof Gtk.CenterBox>;
    if (role === "start") {
      if (box.getStartWidget() !== child) box.setStartWidget(child);
    } else if (role === "center") {
      if (box.getCenterWidget() !== child) box.setCenterWidget(child);
    } else if (role === "end") {
      if (box.getEndWidget() !== child) box.setEndWidget(child);
    } else {
      throw new Error(`vio: VCenterBox children must use the #start, #center or #end slot`);
    }
  },
  removeChild({ parentWidget, child, role }) {
    const box = parentWidget as InstanceType<typeof Gtk.CenterBox>;
    if (role === "start" && box.getStartWidget() === child) box.setStartWidget(null);
    else if (role === "center" && box.getCenterWidget() === child) box.setCenterWidget(null);
    else if (role === "end" && box.getEndWidget() === child) box.setEndWidget(null);
  },
});

define("vio-header-bar", {
  create: () => new Gtk.HeaderBar(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const bar = parentWidget as InstanceType<typeof Gtk.HeaderBar>;
    if (role === "title") {
      if (bar.getTitleWidget() !== child) bar.setTitleWidget(child);
    } else if (role === "start") {
      if (!isInside(child, bar)) bar.packStart(child);
    } else if (role === "end") {
      if (!isInside(child, bar)) bar.packEnd(child);
    } else {
      throw new Error(`vio: VHeaderBar children must use the #start, #end or #title slot`);
    }
  },
  removeChild({ parentWidget, child, role }) {
    const bar = parentWidget as InstanceType<typeof Gtk.HeaderBar>;
    if (role === "title" && bar.getTitleWidget() === child) bar.setTitleWidget(null);
    else if (isInside(child, bar)) bar.remove(child);
  },
});

function flowDetach(flow: InstanceType<typeof Gtk.FlowBox>, child: object): void {
  const wrapper = (child as InstanceType<typeof Gtk.Widget>).getParent();
  flow.remove(child as InstanceType<typeof Gtk.Widget>);
  // GtkFlowBox.remove() detaches the wrapper but leaves the content widget parented to it, so a
  // following insert() trips a Gtk-CRITICAL. Clear the wrapper to release the content first.
  if (wrapper instanceof Gtk.FlowBoxChild && wrapper.getChild() === child) wrapper.setChild(null);
}

define("vio-flow-box", {
  create: () => new Gtk.FlowBox(),
  children: "none",
  insertChild({ parentWidget, child, index }) {
    const flow = parentWidget as InstanceType<typeof Gtk.FlowBox>;
    const current = flowIndex(flow, child);
    if (current === index) return;
    if (current !== -1) flowDetach(flow, child);
    if (index >= flowCount(flow)) flow.append(child);
    else flow.insert(child, Math.max(0, index));
  },
  removeChild({ parentWidget, child }) {
    const flow = parentWidget as InstanceType<typeof Gtk.FlowBox>;
    if (flowIndex(flow, child) !== -1) flowDetach(flow, child);
  },
});

define("vio-fixed", {
  create: () => new Gtk.Fixed(),
  children: "none",
  insertChild({ parentWidget, child, node }) {
    const fixed = parentWidget as InstanceType<typeof Gtk.Fixed>;
    const x = Number(node.props.x ?? 0);
    const y = Number(node.props.y ?? 0);
    if (child.getParent() === fixed) fixed.move(child, x, y);
    else fixed.put(child, x, y);
  },
  removeChild({ parentWidget, child }) {
    const fixed = parentWidget as InstanceType<typeof Gtk.Fixed>;
    if (child.getParent() === fixed) fixed.remove(child);
  },
});

define("list-view", { create: () => new Gtk.ListView(), children: "none" });

export const VNotebook = defineContainerComponent(
  "VNotebook",
  "vio-notebook",
  ({ attrs, slots, element }) => h("vio-notebook", { ...attrs, ref: element }, slots.default?.()),
);

export const VNotebookPage = defineComponent({
  name: "VNotebookPage",
  props: { label: { type: String as PropType<string | undefined>, default: undefined } },
  setup(props, { slots, expose }) {
    const element = shallowRef<VioElement | null>(null);
    const detached = slots["tab-label"] ? useDetachedSlot() : null;
    expose({
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    });
    const notebook = () =>
      element.value?.parent?.widget as InstanceType<typeof Gtk.Notebook> | null;
    const pageWidget = () => element.value?.widget as InstanceType<typeof Gtk.Widget> | undefined;
    onMounted(() => {
      const page = pageWidget();
      const target = detached?.widget;
      const owner = notebook();
      if (page && target && owner)
        owner.setTabLabel(page, target as InstanceType<typeof Gtk.Widget>);
    });
    watch(
      () => props.label,
      (label) => {
        if (detached) return;
        const page = pageWidget();
        const owner = notebook();
        if (!page || !owner || owner.pageNum(page) === -1) return;
        owner.setTabLabel(page, label == null ? null : new Gtk.Label({ label }));
      },
    );
    return () =>
      h(
        "box",
        {
          role: "page",
          ...(detached || props.label == null ? {} : { "tab-label": props.label }),
          ref: element,
        },
        [slots.default?.(), detached?.render(slots["tab-label"])],
      );
  },
});

export const VPaned = defineContainerComponent(
  "VPaned",
  "vio-paned",
  ({ attrs, slots, element }) => {
    const start = slots.start ?? slots.default;
    return h("vio-paned", { ...attrs, ref: element }, [
      start ? h("box", { role: "start" }, start()) : null,
      slots.end ? h("box", { role: "end" }, slots.end()) : null,
    ]);
  },
);

export const VOverlay = defineContainerComponent(
  "VOverlay",
  "vio-overlay",
  ({ attrs, slots, element }) =>
    h("vio-overlay", { ...attrs, ref: element }, [
      slots.default ? h("box", { role: "main" }, slots.default()) : null,
      slots.overlay ? h("box", { role: "overlay" }, slots.overlay()) : null,
    ]),
);

export const VCenterBox = defineContainerComponent(
  "VCenterBox",
  "vio-center-box",
  ({ attrs, slots, element }) =>
    h("vio-center-box", { ...attrs, ref: element }, [
      slots.start ? h("box", { role: "start" }, slots.start()) : null,
      (slots.center ?? slots.default)
        ? h("box", { role: "center" }, (slots.center ?? slots.default)?.())
        : null,
      slots.end ? h("box", { role: "end" }, slots.end()) : null,
    ]),
);

export const VHeaderBar = defineContainerComponent(
  "VHeaderBar",
  "vio-header-bar",
  ({ attrs, slots, element }) =>
    h("vio-header-bar", { ...attrs, ref: element }, [
      (slots.start ?? slots.default)
        ? h("box", { role: "start" }, (slots.start ?? slots.default)?.())
        : null,
      slots.title ? h("box", { role: "title" }, slots.title()) : null,
      slots.end ? h("box", { role: "end" }, slots.end()) : null,
    ]),
);

export const VFlowBox = defineContainerComponent(
  "VFlowBox",
  "vio-flow-box",
  ({ attrs, slots, element }) => h("vio-flow-box", { ...attrs, ref: element }, slots.default?.()),
);

export const VFixed = defineContainerComponent("VFixed", "vio-fixed", ({ attrs, slots, element }) =>
  h("vio-fixed", { ...attrs, ref: element }, slots.default?.()),
);

export const VListView = defineWidgetComponent("VListView", "list-view");

export interface ListModelHandle {
  readonly store: InstanceType<typeof Gio.ListStore>;
  readonly selection: InstanceType<typeof Gtk.SingleSelection>;
  readonly factory: InstanceType<typeof Gtk.SignalListItemFactory>;
}

/**
 * Declarative `Gio.ListStore` + `Gtk.SingleSelection` + `Gtk.SignalListItemFactory`.
 * Renders nothing; place it next to a view and pass `model.selection` / `model.factory`.
 */
export const VListModel = defineComponent({
  name: "VListModel",
  props: {
    items: { type: Array as PropType<string[]>, default: () => [] },
    selected: { type: Number, default: 0 },
  },
  setup(props, { expose }) {
    const store = Gio.ListStore.new(getGType(Gtk.StringObject));
    const selection = new Gtk.SingleSelection({
      model: store,
      autoselect: false,
      canUnselect: true,
    });
    const factory = new Gtk.SignalListItemFactory();
    factory.on("setup", (item: InstanceType<typeof Gtk.ListItem>) => {
      item.setChild(new Gtk.Label({ xalign: 0 }));
    });
    factory.on("bind", (item: InstanceType<typeof Gtk.ListItem>) => {
      const child = item.getChild();
      const object = item.getItem();
      if (child && object)
        (child as InstanceType<typeof Gtk.Label>).setLabel(
          (object as InstanceType<typeof Gtk.StringObject>).getString(),
        );
    });
    const sync = (items: string[] | undefined) => {
      store.splice(
        0,
        store.getNItems(),
        (items ?? []).map((value) => Gtk.StringObject.new(value)),
      );
    };
    sync(props.items);
    watch(() => props.items, sync, { deep: true });
    watch(
      () => props.selected,
      (index) => {
        if (store.getNItems() === 0) return;
        selection.setSelected(Math.max(0, Math.min(Number(index ?? 0), store.getNItems() - 1)));
      },
      { immediate: true },
    );
    expose({ store, selection, factory } satisfies ListModelHandle);
    return () => null;
  },
});
