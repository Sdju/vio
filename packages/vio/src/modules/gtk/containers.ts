import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  Comment,
  Fragment,
  Teleport,
  defineComponent,
  h,
  isVNode,
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
import { createRoot, type VioElement, type VioNode } from "../renderer/index.ts";
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

/**
 * Synthetic slot wrappers exist only to carry a role. When such a wrapper leaves a container,
 * release its single child so a keyed removal does not leave user widgets parented to a detached
 * box. Ordinary role children are left untouched.
 */
function releaseSlot(node: VioNode, widget: InstanceType<typeof Gtk.Widget>): void {
  if (node.props["slot-container"] !== true || !(widget instanceof Gtk.Box)) return;
  for (let child = widget.getFirstChild(); child; child = widget.getFirstChild())
    widget.remove(child);
}

function flattenSlot(slot?: Slot): VNodeChild[] {
  const result: VNodeChild[] = [];
  const visit = (child: VNodeChild): void => {
    if (Array.isArray(child)) {
      for (const item of child) visit(item);
      return;
    }
    if (child == null || typeof child === "boolean") return;
    if (isVNode(child)) {
      if (child.type === Comment) return;
      if (child.type === Fragment) {
        visit(child.children as VNodeChild);
        return;
      }
    }
    result.push(child);
  };
  if (slot) visit(slot());
  return result;
}

/** One role wrapper per slot item, keyed by the item key so reorders keep the wrapper identity. */
function slotWrapper(role: string, item: VNodeChild, index: number): VNode {
  const explicit = isVNode(item) ? item.key : undefined;
  const key = `${role}:${explicit == null ? `index:${index}` : String(explicit)}`;
  return h("box", { role, key, "slot-container": true }, [item]);
}

const roleWidgets = (parent: VioElement, role: string): Array<InstanceType<typeof Gtk.Widget>> =>
  parent.children
    .filter((child) => child.widget && child.props.role === role)
    .map((child) => child.widget as InstanceType<typeof Gtk.Widget>);

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
  removeChild({ parentWidget, child, role, node }) {
    if (role !== "page") return;
    const notebook = parentWidget as InstanceType<typeof Gtk.Notebook>;
    const page = notebook.pageNum(child);
    if (page === -1) return;
    notebook.removePage(page);
    releaseSlot(node, child);
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
  removeChild({ parentWidget, child, role, node }) {
    const paned = parentWidget as InstanceType<typeof Gtk.Paned>;
    if (role === "start" && paned.getStartChild() === child) {
      paned.setStartChild(null);
      releaseSlot(node, child);
    } else if (role === "end" && paned.getEndChild() === child) {
      paned.setEndChild(null);
      releaseSlot(node, child);
    }
  },
});

function overlayLayers(
  overlay: InstanceType<typeof Gtk.Overlay>,
): Array<InstanceType<typeof Gtk.Widget>> {
  const main = overlay.getChild();
  const result: Array<InstanceType<typeof Gtk.Widget>> = [];
  for (let child = overlay.getFirstChild(); child; child = child.getNextSibling())
    if (child !== main) result.push(child);
  return result;
}

function reorderOverlayLayers(
  overlay: InstanceType<typeof Gtk.Overlay>,
  desired: Array<InstanceType<typeof Gtk.Widget>>,
): void {
  const current = overlayLayers(overlay);
  if (current.length === desired.length && current.every((widget, i) => widget === desired[i]))
    return;
  // Gtk.Overlay has no insert-at-index for overlays; remove and re-add preserves widget identity
  // and makes both child order and z-order follow the VNode order.
  for (const widget of current) overlay.removeOverlay(widget);
  for (const widget of desired) overlay.addOverlay(widget);
}

define("vio-overlay", {
  create: () => new Gtk.Overlay(),
  children: "none",
  insertChild({ parentWidget, child, parent, role }) {
    const overlay = parentWidget as InstanceType<typeof Gtk.Overlay>;
    if (role === "overlay") {
      const desired = roleWidgets(parent, "overlay");
      reorderOverlayLayers(overlay, desired.includes(child) ? desired : [...desired, child]);
    } else if (role === "main" || role === null) {
      if (overlay.getChild() !== child) overlay.setChild(child);
    } else {
      throw new Error(`vio: VOverlay children must use role 'main' or 'overlay'`);
    }
  },
  removeChild({ parentWidget, child, role, node }) {
    const overlay = parentWidget as InstanceType<typeof Gtk.Overlay>;
    if ((role === "main" || role === null) && overlay.getChild() === child) {
      overlay.setChild(null);
      releaseSlot(node, child);
    } else if (role === "overlay") {
      if (overlayLayers(overlay).includes(child)) overlay.removeOverlay(child);
      releaseSlot(node, child);
    }
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
  removeChild({ parentWidget, child, role, node }) {
    const box = parentWidget as InstanceType<typeof Gtk.CenterBox>;
    if (role === "start" && box.getStartWidget() === child) {
      box.setStartWidget(null);
      releaseSlot(node, child);
    } else if (role === "center" && box.getCenterWidget() === child) {
      box.setCenterWidget(null);
      releaseSlot(node, child);
    } else if (role === "end" && box.getEndWidget() === child) {
      box.setEndWidget(null);
      releaseSlot(node, child);
    }
  },
});

interface HeaderRoles {
  start: Array<InstanceType<typeof Gtk.Widget>>;
  end: Array<InstanceType<typeof Gtk.Widget>>;
}
const headerRoles = new WeakMap<object, HeaderRoles>();
function headerState(bar: object): HeaderRoles {
  let state = headerRoles.get(bar);
  if (!state) {
    state = { start: [], end: [] };
    headerRoles.set(bar, state);
  }
  return state;
}

/**
 * Gtk.HeaderBar only exposes packStart/packEnd, with no insert-at-index. Rebuild the role group
 * from the VNode order; the widgets themselves are re-packed, so identity and CSS survive.
 * packEnd reverses its internal order, hence the reverse iteration for `#end`.
 */
function repackHeaderRole(
  bar: InstanceType<typeof Gtk.HeaderBar>,
  role: "start" | "end",
  desired: Array<InstanceType<typeof Gtk.Widget>>,
): void {
  const state = headerState(bar);
  for (const widget of state[role]) if (isInside(widget, bar)) bar.remove(widget);
  state[role] = [];
  if (role === "start") {
    for (const widget of desired) {
      bar.packStart(widget);
      state.start.push(widget);
    }
  } else {
    for (let index = desired.length - 1; index >= 0; index--) bar.packEnd(desired[index]!);
    state.end.push(...desired);
  }
}

define("vio-header-bar", {
  create: () => new Gtk.HeaderBar(),
  children: "none",
  insertChild({ parentWidget, child, parent, role }) {
    const bar = parentWidget as InstanceType<typeof Gtk.HeaderBar>;
    if (role === "title") {
      if (bar.getTitleWidget() !== child) bar.setTitleWidget(child);
    } else if (role === "start" || role === "end") {
      const desired = roleWidgets(parent, role);
      repackHeaderRole(bar, role, desired.includes(child) ? desired : [...desired, child]);
    } else {
      throw new Error(`vio: VHeaderBar children must use the #start, #end or #title slot`);
    }
  },
  removeChild({ parentWidget, child, role, node }) {
    const bar = parentWidget as InstanceType<typeof Gtk.HeaderBar>;
    if (role === "title" && bar.getTitleWidget() === child) {
      bar.setTitleWidget(null);
      releaseSlot(node, child);
    } else if (role === "start" || role === "end") {
      const state = headerState(bar);
      state[role] = state[role].filter((widget) => widget !== child);
      if (isInside(child, bar)) bar.remove(child);
      releaseSlot(node, child);
    } else if (isInside(child, bar)) {
      bar.remove(child);
      releaseSlot(node, child);
    }
  },
});

function flowWrapper(
  flow: InstanceType<typeof Gtk.FlowBox>,
  child: InstanceType<typeof Gtk.Widget>,
): InstanceType<typeof Gtk.FlowBoxChild> | null {
  const parent = child.getParent();
  return parent instanceof Gtk.FlowBoxChild &&
    parent.getParent() === flow &&
    parent.getChild() === child
    ? parent
    : null;
}

function flowDetach(
  flow: InstanceType<typeof Gtk.FlowBox>,
  child: InstanceType<typeof Gtk.Widget>,
): void {
  const wrapper = flowWrapper(flow, child);
  if (!wrapper) return;
  flow.remove(child);
  // Removal must detach the user widget too; a move keeps the wrapper and its CSS instead.
  if (wrapper.getChild() === child) wrapper.setChild(null);
}

function flowMove(
  flow: InstanceType<typeof Gtk.FlowBox>,
  child: InstanceType<typeof Gtk.Widget>,
  index: number,
): void {
  const wrapper = flowWrapper(flow, child);
  if (!wrapper) {
    if (index >= flowCount(flow)) flow.append(child);
    else flow.insert(child, Math.max(0, index));
    return;
  }
  // Gtk.FlowBox.remove() leaves the content attached to its GtkFlowBoxChild. Inserting that same
  // child back keeps the wrapper, its classes and the content widget identity intact.
  flow.remove(child);
  if (index >= flowCount(flow)) flow.append(wrapper);
  else flow.insert(wrapper, Math.max(0, index));
}

define("vio-flow-box", {
  create: () => new Gtk.FlowBox(),
  children: "none",
  insertChild({ parentWidget, child, index }) {
    const flow = parentWidget as InstanceType<typeof Gtk.FlowBox>;
    const current = flowIndex(flow, child);
    if (current === index) return;
    flowMove(flow, child, index);
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
          "slot-container": true,
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
      start ? h("box", { role: "start", key: "start", "slot-container": true }, start()) : null,
      slots.end ? h("box", { role: "end", key: "end", "slot-container": true }, slots.end()) : null,
    ]);
  },
);

export const VOverlay = defineContainerComponent(
  "VOverlay",
  "vio-overlay",
  ({ attrs, slots, element }) => {
    const overlays = flattenSlot(slots.overlay);
    return h("vio-overlay", { ...attrs, ref: element }, [
      slots.default
        ? h("box", { role: "main", key: "main", "slot-container": true }, slots.default())
        : null,
      ...overlays.map((item, index) => slotWrapper("overlay", item, index)),
    ]);
  },
);

export const VCenterBox = defineContainerComponent(
  "VCenterBox",
  "vio-center-box",
  ({ attrs, slots, element }) =>
    h("vio-center-box", { ...attrs, ref: element }, [
      slots.start
        ? h("box", { role: "start", key: "start", "slot-container": true }, slots.start())
        : null,
      (slots.center ?? slots.default)
        ? h(
            "box",
            { role: "center", key: "center", "slot-container": true },
            (slots.center ?? slots.default)?.(),
          )
        : null,
      slots.end ? h("box", { role: "end", key: "end", "slot-container": true }, slots.end()) : null,
    ]),
);

export const VHeaderBar = defineContainerComponent(
  "VHeaderBar",
  "vio-header-bar",
  ({ attrs, slots, element }) => {
    const start = flattenSlot(slots.start ?? slots.default);
    const end = flattenSlot(slots.end);
    return h("vio-header-bar", { ...attrs, ref: element }, [
      ...start.map((item, index) => slotWrapper("start", item, index)),
      slots.title
        ? h("box", { role: "title", key: "title", "slot-container": true }, slots.title())
        : null,
      ...end.map((item, index) => slotWrapper("end", item, index)),
    ]);
  },
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
