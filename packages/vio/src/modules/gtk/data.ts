import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  Comment,
  Fragment,
  Teleport,
  cloneVNode,
  defineComponent,
  h,
  inject,
  isVNode,
  markRaw,
  onMounted,
  onUnmounted,
  provide,
  shallowRef,
  triggerRef,
  watch,
  type PropType,
  type ShallowRef,
  type Slot,
  type VNode,
  type VNodeChild,
} from "@vue/runtime-core";
import { createRoot, type VioElement } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";
import {
  defineContainerComponent,
  packedRoleState,
  releaseSlot,
  repackPackedRole,
  roleWidgets,
} from "./containers.ts";

type Attrs = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;
type NativeWidget = InstanceType<typeof Gtk.Widget>;
type ListItem = InstanceType<typeof Gtk.ListItem>;
type SelectionMode = "single" | "multiple" | "none";
type SelectionModel =
  | InstanceType<typeof Gtk.SingleSelection>
  | InstanceType<typeof Gtk.MultiSelection>
  | InstanceType<typeof Gtk.NoSelection>;

function useElement() {
  const element = shallowRef<VioElement | null>(null);
  return {
    element,
    expose: {
      element,
      get widget() {
        return element.value?.widget ?? null;
      },
    },
  };
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

function isDescendant(child: NativeWidget, ancestor: NativeWidget): boolean {
  let node = child.getParent();
  while (node) {
    if (node === ancestor) return true;
    node = node.getParent();
  }
  return false;
}

function selectionModeOf(value: string): SelectionMode {
  if (value === "single" || value === "multiple" || value === "none") return value;
  throw new Error(`vio: unknown selection-mode '${value}'; use 'single', 'multiple' or 'none'`);
}

export interface ListModelHandle {
  readonly store: InstanceType<typeof Gio.ListStore>;
  readonly selection: InstanceType<typeof Gtk.SingleSelection>;
  readonly factory: InstanceType<typeof Gtk.SignalListItemFactory>;
}

/**
 * `Gio.ListStore` + `Gtk.SingleSelection` + a caller-supplied item factory, rebuilt from a string
 * array on every change.
 */
export function useListModel(
  items: () => string[] | undefined,
  factory: InstanceType<typeof Gtk.SignalListItemFactory>,
): ListModelHandle {
  const store = Gio.ListStore.new(getGType(Gtk.StringObject));
  const selection = new Gtk.SingleSelection({
    model: store,
    autoselect: false,
    canUnselect: true,
  });
  const sync = () => {
    store.splice(
      0,
      store.getNItems(),
      (items() ?? []).map((value) => Gtk.StringObject.new(value)),
    );
  };
  sync();
  watch(items, sync, { deep: true });
  return { store, selection, factory };
}

/** Declarative list model resource; place it next to a `VListView`. */
export const VListModel = defineComponent({
  name: "VListModel",
  props: {
    items: { type: Array as PropType<string[]>, default: () => [] },
    selected: { type: Number, default: 0 },
  },
  setup(props, { expose }) {
    const factory = new Gtk.SignalListItemFactory();
    factory.on("setup", (item: ListItem) => {
      item.setChild(new Gtk.Label({ xalign: 0 }));
    });
    factory.on("bind", (item: ListItem) => {
      const child = item.getChild();
      const object = item.getItem();
      if (child && object)
        (child as InstanceType<typeof Gtk.Label>).setLabel(
          (object as InstanceType<typeof Gtk.StringObject>).getString(),
        );
    });
    const handle = useListModel(() => props.items, factory);
    watch(
      () => props.selected,
      (index) => {
        if (handle.store.getNItems() === 0) return;
        handle.selection.setSelected(
          Math.max(0, Math.min(Number(index ?? 0), handle.store.getNItems() - 1)),
        );
      },
      { immediate: true },
    );
    expose(handle);
    return () => null;
  },
});

/* ------------------------------------------------------------------------------------------------
 * Selection plumbing shared by the collection views.
 * ---------------------------------------------------------------------------------------------- */

function createSelection(model: object | null, mode: SelectionMode): SelectionModel | null {
  if (!model) return null;
  if (mode === "multiple")
    return new Gtk.MultiSelection({ model: model as InstanceType<typeof Gio.ListStore> });
  if (mode === "none")
    return new Gtk.NoSelection({ model: model as InstanceType<typeof Gio.ListStore> });
  return new Gtk.SingleSelection({
    model: model as InstanceType<typeof Gio.ListStore>,
    autoselect: false,
    canUnselect: true,
  });
}

function selectionIndices(selection: SelectionModel | null, mode: SelectionMode): number[] {
  if (!selection) return [];
  if (mode === "multiple") {
    const bitset = selection.getSelection();
    const result: number[] = [];
    for (let index = 0; index < selection.getNItems(); index++)
      if (bitset.contains(index)) result.push(index);
    return result;
  }
  if (mode === "none") return [];
  const selected = (selection as InstanceType<typeof Gtk.SingleSelection>).getSelected();
  return selected === Gtk.INVALID_LIST_POSITION ? [] : [selected];
}

function sameIndices(a: number | number[] | undefined, b: number[]): boolean {
  if (a === undefined) return false;
  const left = Array.isArray(a) ? a : a < 0 ? [] : [a];
  return left.length === b.length && left.every((value, index) => value === b[index]);
}

function selectionValue(indices: number[], mode: SelectionMode): number | number[] {
  return mode === "multiple" ? indices : (indices[0] ?? -1);
}

function applyIndices(
  selection: SelectionModel | null,
  mode: SelectionMode,
  value: number | number[] | undefined,
): void {
  if (!selection) return;
  const indices =
    value === undefined ? [] : Array.isArray(value) ? value : value < 0 ? [] : [value];
  if (mode === "none") return;
  if (mode === "multiple") {
    selection.unselectAll();
    for (const index of indices)
      if (index >= 0 && index < selection.getNItems()) selection.selectItem(index, false);
    return;
  }
  const single = selection as InstanceType<typeof Gtk.SingleSelection>;
  const index = indices[0];
  single.setSelected(
    index === undefined || index < 0 || index >= selection.getNItems()
      ? Gtk.INVALID_LIST_POSITION
      : index,
  );
}

function useSelection(
  props: {
    model: object | null;
    selected?: number | number[];
    modelValue?: number | number[];
    selectionMode: string;
  },
  emit: (name: string, ...args: unknown[]) => void,
) {
  const mode = () => selectionModeOf(props.selectionMode);
  const selection = shallowRef<SelectionModel | null>(null);
  let listener: ((...args: unknown[]) => void) | null = null;
  let current: SelectionModel | null = null;
  let applying = false;

  const detach = () => {
    if (current && listener) current.off("selection-changed", listener);
    current = null;
    listener = null;
  };
  const changed = () => {
    if (!current || applying) return;
    const indices = selectionIndices(current, mode());
    const value = selectionValue(indices, mode());
    if (!sameIndices(props.selected, indices)) emit("update:selected", value);
    if (!sameIndices(props.modelValue, indices)) emit("update:modelValue", value);
  };
  const apply = (value: number | number[] | undefined) => {
    applying = true;
    try {
      applyIndices(current, mode(), value);
    } finally {
      applying = false;
    }
  };
  const rebuild = () => {
    detach();
    current = createSelection(props.model, mode());
    apply(props.selected ?? props.modelValue);
    if (current) {
      listener = changed;
      current.on("selection-changed", listener);
    }
    selection.value = current ? markRaw(current) : null;
  };
  rebuild();
  watch(() => [props.model, props.selectionMode] as const, rebuild, { flush: "post" });
  watch(
    () => [props.selected, props.modelValue] as const,
    () => {
      const controlled = props.selected ?? props.modelValue;
      if (sameIndices(controlled, selectionIndices(current, mode()))) return;
      apply(controlled);
    },
    { deep: true },
  );
  onUnmounted(detach);
  return {
    get selection() {
      return selection.value;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Widget-backed cells: every Gtk.ListItem owns a detached root; the slot is teleported into it.
 * ---------------------------------------------------------------------------------------------- */

interface CellRecord {
  key: number;
  root: VioElement;
  item: object | null;
  position: number;
}

interface BoundCell extends CellRecord {
  listItem: ListItem;
}

const cellProperty = "__vioCell" as const;

function bindCell(
  cells: ShallowRef<CellRecord[]>,
  listItem: ListItem,
  disposed: () => boolean,
): void {
  const cell = (listItem as unknown as Record<string, BoundCell | undefined>)[cellProperty];
  if (!cell || disposed()) return;
  cell.item = listItem.getItem();
  const position = listItem.getPosition();
  cell.position = position === Gtk.INVALID_LIST_POSITION ? -1 : position;
  if (!cells.value.includes(cell)) cells.value = [...cells.value, cell];
  else triggerRef(cells);
}

function releaseCell(
  cells: ShallowRef<CellRecord[]>,
  listItem: ListItem,
  disposed: () => boolean,
): void {
  const cell = (listItem as unknown as Record<string, BoundCell | undefined>)[cellProperty];
  if (!cell) return;
  if (!disposed()) cells.value = cells.value.filter((entry) => entry !== cell);
}

function teardownCell(
  cells: ShallowRef<CellRecord[]>,
  listItem: ListItem,
  disposed: () => boolean,
): void {
  const cell = (listItem as unknown as Record<string, BoundCell | undefined>)[cellProperty];
  if (!cell) return;
  if (!disposed()) cells.value = cells.value.filter((entry) => entry !== cell);
  listItem.setChild(null);
  delete (listItem as unknown as Record<string, unknown>)[cellProperty];
}

function cellNodes(cells: ReadonlyArray<CellRecord>, slot: Slot | undefined): VNode[] {
  if (!slot) return [];
  return cells.map((cell) => {
    const content = slot({ item: cell.item, position: cell.position });
    return h(
      Teleport,
      { key: cell.key, to: cell.root as unknown as string },
      Array.isArray(content) ? content : [content],
    );
  });
}

function createFactory(
  cells: ShallowRef<CellRecord[]>,
  disposed: () => boolean,
): { factory: InstanceType<typeof Gtk.SignalListItemFactory> } {
  let counter = 0;
  const factory = new Gtk.SignalListItemFactory();
  factory.on("setup", (listItem: ListItem) => {
    const box = new Gtk.Box();
    listItem.setChild(box);
    const cell: BoundCell = {
      key: ++counter,
      root: createRoot(box),
      item: null,
      position: -1,
      listItem,
    };
    (listItem as unknown as Record<string, unknown>)[cellProperty] = cell;
  });
  factory.on("bind", (listItem: ListItem) => bindCell(cells, listItem, disposed));
  factory.on("unbind", (listItem: ListItem) => releaseCell(cells, listItem, disposed));
  factory.on("teardown", (listItem: ListItem) => teardownCell(cells, listItem, disposed));
  return { factory };
}

/* ------------------------------------------------------------------------------------------------
 * Collection views.
 * ---------------------------------------------------------------------------------------------- */

const viewProps = {
  model: { type: Object as PropType<object | null>, default: null },
  selected: {
    type: [Number, Array] as PropType<number | number[] | undefined>,
    default: undefined,
  },
  modelValue: {
    type: [Number, Array] as PropType<number | number[] | undefined>,
    default: undefined,
  },
  selectionMode: { type: String as PropType<SelectionMode>, default: "single" },
};
const viewEmits = ["update:selected", "update:modelValue"];

const columnViewKey = "vio-column-view";

interface ColumnViewApi {
  add(column: InstanceType<typeof Gtk.ColumnViewColumn>): void;
  remove(column: InstanceType<typeof Gtk.ColumnViewColumn>): void;
}

export const VColumnView = defineComponent({
  name: "VColumnView",
  inheritAttrs: false,
  props: {
    ...viewProps,
    showRowSeparators: { type: Boolean, default: false },
    reorderable: { type: Boolean, default: false },
  },
  emits: viewEmits,
  setup(props, { attrs, slots, expose, emit }) {
    const { element, expose: handle } = useElement();
    const selectionApi = useSelection(props, emit);
    const pending = new Set<InstanceType<typeof Gtk.ColumnViewColumn>>();
    const attached = new Set<InstanceType<typeof Gtk.ColumnViewColumn>>();
    let mountedView: InstanceType<typeof Gtk.ColumnView> | null = null;
    const view = () =>
      (element.value?.widget as InstanceType<typeof Gtk.ColumnView> | undefined) ??
      mountedView ??
      undefined;
    const flush = () => {
      const columnView = view();
      if (!columnView) return;
      for (const column of pending) {
        columnView.appendColumn(column);
        attached.add(column);
      }
      pending.clear();
    };
    const api: ColumnViewApi = {
      add(column) {
        pending.add(column);
        flush();
      },
      remove(column) {
        pending.delete(column);
        const columnView = view();
        if (columnView && attached.has(column)) {
          columnView.removeColumn(column);
          attached.delete(column);
        }
      },
    };
    provide(columnViewKey, api);
    onMounted(() => {
      mountedView =
        (element.value?.widget as InstanceType<typeof Gtk.ColumnView> | undefined) ?? null;
      flush();
    });
    onUnmounted(() => {
      const columnView = view();
      if (columnView) columnView.setModel(null);
      attached.clear();
      pending.clear();
    });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get selection() {
        return selectionApi.selection;
      },
    });
    return () =>
      h(
        "column-view",
        {
          ...attrs,
          ref: element,
          model: selectionApi.selection,
          showRowSeparators: props.showRowSeparators,
          reorderable: props.reorderable,
        },
        slots.columns?.(),
      );
  },
});

export const VColumnViewColumn = defineComponent({
  name: "VColumnViewColumn",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    expand: { type: Boolean, default: false },
    fixedWidth: { type: Number, default: -1 },
  },
  setup(props, { slots, expose }) {
    const column = new Gtk.ColumnViewColumn();
    const cells = shallowRef<CellRecord[]>([]);
    let disposed = false;
    const isDisposed = () => disposed;
    const { factory } = createFactory(cells, isDisposed);
    const refresh = () => {
      column.setTitle(props.title ?? null);
      column.setExpand(props.expand);
      column.setFixedWidth(props.fixedWidth);
    };
    refresh();
    watch(() => [props.title, props.expand, props.fixedWidth] as const, refresh, { flush: "post" });
    if (slots.cell) column.setFactory(factory);
    const api = inject<ColumnViewApi | null>(columnViewKey, null);
    onMounted(() => api?.add(column));
    onUnmounted(() => {
      disposed = true;
      column.setFactory(null);
      api?.remove(column);
      cells.value = [];
    });
    expose({
      column,
      factory,
      get widget() {
        return column;
      },
    });
    return () => cellNodes(cells.value, slots.cell);
  },
});

export const VGridView = defineComponent({
  name: "VGridView",
  inheritAttrs: false,
  props: {
    ...viewProps,
    minColumns: { type: Number, default: -1 },
    maxColumns: { type: Number, default: -1 },
  },
  emits: viewEmits,
  setup(props, { attrs, slots, expose, emit }) {
    const { element, expose: handle } = useElement();
    const selectionApi = useSelection(props, emit);
    const cells = shallowRef<CellRecord[]>([]);
    let disposed = false;
    let mountedGrid: InstanceType<typeof Gtk.GridView> | null = null;
    const isDisposed = () => disposed;
    const { factory } = createFactory(cells, isDisposed);
    onMounted(() => {
      mountedGrid =
        (element.value?.widget as InstanceType<typeof Gtk.GridView> | undefined) ?? null;
    });
    onUnmounted(() => {
      disposed = true;
      const grid =
        (element.value?.widget as InstanceType<typeof Gtk.GridView> | undefined) ?? mountedGrid;
      if (grid) {
        grid.setFactory(null);
        grid.setModel(null);
      }
      cells.value = [];
    });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      factory,
      get selection() {
        return selectionApi.selection;
      },
    });
    return () =>
      h(
        "grid-view",
        {
          ...attrs,
          ref: element,
          model: selectionApi.selection,
          factory,
          minColumns: props.minColumns,
          maxColumns: props.maxColumns,
        },
        cellNodes(cells.value, slots.item),
      );
  },
});

export const VIconView = defineComponent({
  name: "VIconView",
  inheritAttrs: false,
  props: {
    model: { type: Object as PropType<object | null>, default: null },
    selected: {
      type: [Number, Array] as PropType<number | number[] | undefined>,
      default: undefined,
    },
    modelValue: {
      type: [Number, Array] as PropType<number | number[] | undefined>,
      default: undefined,
    },
    selectionMode: { type: String as PropType<SelectionMode>, default: "single" },
    markupColumn: { type: Number, default: -1 },
  },
  emits: viewEmits,
  setup(props, { attrs, slots, expose, emit }) {
    if (slots.item)
      throw new Error(
        "vio: 'VIconView' does not support #item; Gtk.IconView renders cells from a Gtk.TreeModel — use VGridView for widget cells",
      );
    const { element, expose: handle } = useElement();
    const mode = () => selectionModeOf(props.selectionMode);
    let applying = false;
    let mountedIconView: InstanceType<typeof Gtk.IconView> | null = null;
    const iconView = () =>
      (element.value?.widget as InstanceType<typeof Gtk.IconView> | undefined) ??
      mountedIconView ??
      undefined;
    const indices = () => {
      const icon = iconView();
      if (!icon || mode() === "none") return [];
      return (icon.getSelectedItems() ?? [])
        .map((path) => (path as unknown as { getIndices(): number[] }).getIndices()[0] ?? -1)
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
    };
    const changed = () => {
      if (applying) return;
      const next = indices();
      const value = selectionValue(next, mode());
      if (!sameIndices(props.selected, next)) emit("update:selected", value);
      if (!sameIndices(props.modelValue, next)) emit("update:modelValue", value);
    };
    const apply = () => {
      const icon = iconView();
      if (!icon) return;
      const controlled = props.selected ?? props.modelValue;
      if (sameIndices(controlled, indices())) return;
      const wanted =
        controlled === undefined
          ? []
          : Array.isArray(controlled)
            ? controlled
            : controlled < 0
              ? []
              : [controlled];
      const count = icon.getModel()?.iterNChildren(null) ?? 0;
      applying = true;
      try {
        icon.unselectAll();
        if (mode() !== "none")
          for (const index of wanted)
            if (index >= 0 && index < count) {
              icon.selectPath(Gtk.TreePath.newFromIndices([index]));
              if (mode() === "single") break;
            }
      } finally {
        applying = false;
      }
    };
    onMounted(() => {
      mountedIconView =
        (element.value?.widget as InstanceType<typeof Gtk.IconView> | undefined) ?? null;
      iconView()?.on("selection-changed", changed);
      apply();
    });
    watch(
      () => [props.model, props.selected, props.modelValue, props.selectionMode] as const,
      apply,
      { flush: "post", deep: true },
    );
    onUnmounted(() => {
      const icon = iconView();
      if (icon) {
        icon.off("selection-changed", changed);
        icon.setModel(null);
      }
    });
    expose(handle);
    return () =>
      h("icon-view", {
        ...attrs,
        ref: element,
        model: props.model,
        markupColumn: props.markupColumn,
        selectionMode: props.selectionMode,
      });
  },
});

/* ------------------------------------------------------------------------------------------------
 * Text and input widgets.
 * ---------------------------------------------------------------------------------------------- */

const wrapModes: Record<string, number> = {
  none: Gtk.WrapMode.NONE,
  char: Gtk.WrapMode.CHAR,
  word: Gtk.WrapMode.WORD,
  "word-char": Gtk.WrapMode.WORD_CHAR,
};

function wrapModeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const mode = wrapModes[value];
  if (mode === undefined) throw new Error(`vio: unknown wrap-mode '${value}'`);
  return mode;
}

export const VTextView = defineComponent({
  name: "VTextView",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    editable: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    wrapMode: { type: String as PropType<string | undefined>, default: undefined },
    monospace: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    buffer: { type: Object as PropType<InstanceType<typeof Gtk.TextBuffer> | null>, default: null },
  },
  emits: ["update:text", "update:modelValue"],
  setup(props, { attrs, expose, emit }) {
    const { element, expose: handle } = useElement();
    const internal = markRaw(new Gtk.TextBuffer());
    const activeBuffer = () => props.buffer ?? internal;
    let bound: InstanceType<typeof Gtk.TextBuffer> | null = null;
    let syncing = false;
    let disposed = false;
    let scheduled = false;
    let lastEmitted: string | undefined;
    const textIn = (buffer: InstanceType<typeof Gtk.TextBuffer>) =>
      buffer.getText(buffer.getStartIter(), buffer.getEndIter(), true) ?? "";
    const changed = () => {
      if (syncing || !bound || scheduled) return;
      // GtkTextBuffer.setText() emits a delete/insert pair synchronously; emit once with the
      // final text instead of leaking the intermediate empty state into v-model.
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed || syncing || !bound) return;
        const next = textIn(bound);
        if (next === lastEmitted) return;
        lastEmitted = next;
        if (props.text !== undefined && next !== props.text) emit("update:text", next);
        if (props.modelValue !== undefined && next !== props.modelValue)
          emit("update:modelValue", next);
      });
    };
    const attach = () => {
      const buffer = activeBuffer();
      if (bound === buffer) return;
      bound?.off("changed", changed);
      bound = buffer;
      bound.on("changed", changed);
    };
    const applyText = () => {
      const buffer = activeBuffer();
      attach();
      const text = props.text ?? props.modelValue;
      if (text === undefined || textIn(buffer) === text) return;
      syncing = true;
      try {
        buffer.setText(text, -1);
        lastEmitted = text;
      } finally {
        syncing = false;
      }
    };
    onMounted(applyText);
    watch(() => [props.buffer, props.text, props.modelValue] as const, applyText, {
      flush: "post",
    });
    onUnmounted(() => {
      disposed = true;
      bound?.off("changed", changed);
      bound = null;
    });
    expose(handle);
    return () => {
      const mode = wrapModeOf(props.wrapMode);
      return h("text-view", {
        ...attrs,
        ref: element,
        buffer: activeBuffer(),
        ...(props.editable === undefined ? {} : { editable: props.editable }),
        ...(props.monospace === undefined ? {} : { monospace: props.monospace }),
        ...(mode === undefined ? {} : { wrapMode: mode }),
      });
    };
  },
});

export const VEditableLabel = defineComponent({
  name: "VEditableLabel",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    editable: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:text", "update:modelValue"],
  setup(props, { attrs, expose, emit }) {
    const { element, expose: handle } = useElement();
    const changed = () => {
      const label = element.value?.widget as InstanceType<typeof Gtk.EditableLabel> | undefined;
      if (!label) return;
      const next = label.getText();
      if (props.text !== undefined && next !== props.text) emit("update:text", next);
      if (props.modelValue !== undefined && next !== props.modelValue)
        emit("update:modelValue", next);
    };
    expose(handle);
    return () => {
      const text = props.text ?? props.modelValue;
      const { attrs: rest, handlers } = withHandler(attrs, "onNotify::text", changed);
      return h("editable-label", {
        ...rest,
        ref: element,
        ...(text === undefined ? {} : { text }),
        ...(props.editable === undefined ? {} : { editable: props.editable }),
        "onNotify::text": handlers,
      });
    };
  },
});

export const VSearchEntry = defineComponent({
  name: "VSearchEntry",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    placeholderText: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ["update:text", "update:modelValue", "search"],
  setup(props, { attrs, expose, emit }) {
    const { element, expose: handle } = useElement();
    let disposed = false;
    let scheduled = false;
    let pending: string | null = null;
    const entry = () => element.value?.widget as InstanceType<typeof Gtk.SearchEntry> | undefined;
    const changed = () => {
      const search = entry();
      if (!search || disposed) return;
      const next = search.getText();
      const controlled = props.text ?? props.modelValue;
      if (controlled !== undefined && next === controlled) {
        pending = null;
        return;
      }
      pending = next;
      if (scheduled) return;
      // GtkEditable::changed can fire as a delete/insert pair for one edit; batch the burst in a
      // microtask (not a timer): @search stays undebounced and sees the final text exactly once.
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const value = pending;
        pending = null;
        if (disposed || value === null) return;
        if (props.text !== undefined && value !== props.text) emit("update:text", value);
        if (props.modelValue !== undefined && value !== props.modelValue)
          emit("update:modelValue", value);
        // GTK4 removed GtkSearchEntry::search, and the surviving search-changed signal applies
        // GTK's own 150 ms delay. Proxy the immediate GtkEditable::changed signal instead, so
        // debouncing stays the caller's responsibility.
        emit("search", value);
      });
    };
    onUnmounted(() => {
      disposed = true;
    });
    expose(handle);
    return () => {
      const { attrs: rest, handlers } = withHandler(attrs, "onChanged", changed);
      return h("search-entry", {
        ...rest,
        ref: element,
        ...(props.text === undefined && props.modelValue === undefined
          ? {}
          : { text: props.text ?? props.modelValue }),
        ...(props.placeholderText === undefined ? {} : { placeholderText: props.placeholderText }),
        onChanged: handlers,
      });
    };
  },
});

const inscriptionOverflows: Record<string, number> = {
  clip: Gtk.InscriptionOverflow.CLIP,
  start: Gtk.InscriptionOverflow.ELLIPSIZE_START,
  middle: Gtk.InscriptionOverflow.ELLIPSIZE_MIDDLE,
  end: Gtk.InscriptionOverflow.ELLIPSIZE_END,
};

export const VInscription = defineComponent({
  name: "VInscription",
  inheritAttrs: false,
  props: {
    text: { type: String as PropType<string | undefined>, default: undefined },
    markup: { type: String as PropType<string | undefined>, default: undefined },
    natChars: { type: Number as PropType<number | undefined>, default: undefined },
    natLines: { type: Number as PropType<number | undefined>, default: undefined },
    textOverflow: { type: String as PropType<string | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    if (slots.default)
      throw new Error(`vio: 'VInscription' cannot contain children; use text or markup`);
    const { element, expose: handle } = useElement();
    expose(handle);
    return () => {
      if (props.text !== undefined && props.markup !== undefined)
        throw new Error(`vio: VInscription accepts either 'text' or 'markup', not both`);
      const overflow =
        props.textOverflow === undefined ? undefined : inscriptionOverflows[props.textOverflow];
      if (props.textOverflow !== undefined && overflow === undefined)
        throw new Error(`vio: unknown text-overflow '${props.textOverflow}'`);
      return h("inscription", {
        ...attrs,
        ref: element,
        ...(props.text === undefined ? {} : { text: props.text }),
        ...(props.markup === undefined ? {} : { markup: props.markup }),
        ...(props.natChars === undefined ? {} : { natChars: props.natChars }),
        ...(props.natLines === undefined ? {} : { natLines: props.natLines }),
        ...(overflow === undefined ? {} : { textOverflow: overflow }),
      });
    };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Panels.
 * ---------------------------------------------------------------------------------------------- */

const searchBarDefinition: WidgetDefinition = {
  create: () => new Gtk.SearchBar(),
  children: "none",
  insertChild({ parentWidget, child }) {
    if (!(child instanceof Gtk.SearchEntry))
      throw new Error(`vio: 'VSearchBar' requires a VSearchEntry child`);
    const bar = parentWidget as InstanceType<typeof Gtk.SearchBar>;
    if (bar.getChild() !== child) bar.setChild(child);
    bar.connectEntry(child);
  },
  removeChild({ parentWidget, child }) {
    const bar = parentWidget as InstanceType<typeof Gtk.SearchBar>;
    if (bar.getChild() === child) bar.setChild(null);
  },
};

define("vio-search-bar", searchBarDefinition);

export const VSearchBar = defineComponent({
  name: "VSearchBar",
  inheritAttrs: false,
  props: {
    searchModeEnabled: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showCloseButton: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["update:searchModeEnabled"],
  setup(props, { attrs, slots, expose, emit }) {
    const { element, expose: handle } = useElement();
    const changed = () => {
      const bar = element.value?.widget as InstanceType<typeof Gtk.SearchBar> | undefined;
      if (!bar || props.searchModeEnabled === undefined) return;
      const next = bar.getSearchMode();
      if (next !== props.searchModeEnabled) emit("update:searchModeEnabled", next);
    };
    expose(handle);
    return () => {
      const { attrs: rest, handlers } = withHandler(
        attrs,
        "onNotify::search-mode-enabled",
        changed,
      );
      return h(
        "vio-search-bar",
        {
          ...rest,
          ref: element,
          ...(props.searchModeEnabled === undefined
            ? {}
            : { searchModeEnabled: props.searchModeEnabled }),
          ...(props.showCloseButton === undefined
            ? {}
            : { showCloseButton: props.showCloseButton }),
          "onNotify::search-mode-enabled": handlers,
        },
        slots.default?.(),
      );
    };
  },
});

const actionBarDefinition: WidgetDefinition = {
  create: () => new Gtk.ActionBar(),
  children: "none",
  insertChild({ parentWidget, child, parent, role }) {
    const bar = parentWidget as InstanceType<typeof Gtk.ActionBar>;
    if (role === "start" || role === "end") {
      const desired = roleWidgets(parent, role);
      repackPackedRole(
        bar,
        packedRoleState(bar),
        role,
        desired.includes(child) ? desired : [...desired, child],
        { start: (widget) => bar.packStart(widget), end: (widget) => bar.packEnd(widget) },
      );
      return;
    }
    throw new Error(`vio: VActionBar children must use the #start or #end slot`);
  },
  removeChild({ parentWidget, child, role, node }) {
    const bar = parentWidget as InstanceType<typeof Gtk.ActionBar>;
    if (role !== "start" && role !== "end") return;
    const state = packedRoleState(bar);
    state[role] = state[role].filter((widget) => widget !== child);
    if (isDescendant(child, bar)) bar.remove(child);
    releaseSlot(node, child);
  },
};

define("vio-action-bar", actionBarDefinition);

export const VActionBar = defineContainerComponent(
  "VActionBar",
  "vio-action-bar",
  ({ attrs, slots, element }) => {
    const start = flatten(slots.start ?? slots.default);
    const end = flatten(slots.end);
    return h("vio-action-bar", { ...attrs, ref: element }, [
      ...start.map((item, index) => slotWrapper("start", item, index)),
      ...end.map((item, index) => slotWrapper("end", item, index)),
    ]);
  },
);

const messageTypes: Record<string, number> = {
  info: Gtk.MessageType.INFO,
  warning: Gtk.MessageType.WARNING,
  question: Gtk.MessageType.QUESTION,
  error: Gtk.MessageType.ERROR,
  other: Gtk.MessageType.OTHER,
};

const infoBarDefinition: WidgetDefinition = {
  create: () => new Gtk.InfoBar(),
  children: "none",
  insertChild({ parentWidget, child, role }) {
    const bar = parentWidget as InstanceType<typeof Gtk.InfoBar>;
    if (role === "action") {
      // GTK 4.24 puts the action slot through Gtk.InfoBar.addActionWidget().
      bar.addActionWidget(child, Gtk.ResponseType.NONE);
      return;
    }
    if (role === "content" || role === null) {
      bar.addChild(child);
      return;
    }
    throw new Error(`vio: VInfoBar children must use the #content or #action slot`);
  },
  removeChild({ parentWidget, child, role, node }) {
    const bar = parentWidget as InstanceType<typeof Gtk.InfoBar>;
    if (role === "action") bar.removeActionWidget(child);
    else if (role === "content" || role === null) bar.removeChild(child);
    else return;
    releaseSlot(node, child);
  },
};

define("vio-info-bar", infoBarDefinition);

export const VInfoBar = defineComponent({
  name: "VInfoBar",
  inheritAttrs: false,
  props: {
    messageType: { type: String as PropType<string | undefined>, default: undefined },
    showCloseButton: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, expose: handle } = useElement();
    expose(handle);
    return () => {
      const messageType =
        props.messageType === undefined ? undefined : messageTypes[props.messageType];
      if (props.messageType !== undefined && messageType === undefined)
        throw new Error(`vio: unknown message-type '${props.messageType}'`);
      const content = slots.content ?? slots.default;
      // Gtk.InfoBar.addActionWidget() only accepts activatable widgets (buttons), so the action
      // slot is routed widget-by-widget instead of through a GtkBox role wrapper. Content has no
      // such restriction and keeps a wrapper so several widgets can share one addChild() call.
      const action = flatten(slots.action)
        .filter((item): item is VNode => isVNode(item))
        .map((item) => cloneVNode(item, { role: "action" }));
      return h(
        "vio-info-bar",
        {
          ...attrs,
          ref: element,
          ...(messageType === undefined ? {} : { messageType }),
          ...(props.showCloseButton === undefined
            ? {}
            : { showCloseButton: props.showCloseButton }),
        },
        [
          content
            ? h("box", { role: "content", key: "content", "slot-container": true }, content())
            : null,
          ...action,
        ],
      );
    };
  },
});

const statusbarDefinition: WidgetDefinition = {
  create: () => new Gtk.Statusbar(),
  children: "none",
};

define("vio-statusbar", statusbarDefinition);

export const VStatusbar = defineComponent({
  name: "VStatusbar",
  inheritAttrs: false,
  props: { messages: { type: Array as PropType<string[]>, default: () => [] } },
  setup(props, { attrs, expose }) {
    const { element, expose: handle } = useElement();
    let context: number | null = null;
    const sync = () => {
      const bar = element.value?.widget as InstanceType<typeof Gtk.Statusbar> | undefined;
      if (!bar) return;
      context ??= bar.getContextId("vio");
      bar.removeAll(context);
      for (const message of props.messages) bar.push(context, message);
    };
    onMounted(sync);
    watch(() => props.messages, sync, { deep: true });
    expose(handle);
    return () => h("vio-statusbar", { ...attrs, ref: element });
  },
});

/* ------------------------------------------------------------------------------------------------
 * Legacy tree view. Gtk.TreeView and Gtk.Statusbar are deprecated upstream since GTK 4.10.
 * Columns are declared through `VTreeViewColumn` with `VCellRendererText`/`Toggle`/`Pixbuf`
 * wrappers around the real `Gtk.CellRenderer*` objects; the wrappers are not internal cell parts.
 * ---------------------------------------------------------------------------------------------- */

const treeViewKey = "vio-tree-view";
const treeColumnKey = "vio-tree-view-column";

interface TreeViewApi {
  add(column: InstanceType<typeof Gtk.TreeViewColumn>): void;
  remove(column: InstanceType<typeof Gtk.TreeViewColumn>): void;
}

interface TreeColumnApi {
  pack(renderer: InstanceType<typeof Gtk.CellRenderer>): void;
  attribute(
    renderer: InstanceType<typeof Gtk.CellRenderer>,
    attribute: string,
    modelColumn: number,
  ): void;
  clear(renderer: InstanceType<typeof Gtk.CellRenderer>): void;
}

export const VTreeView = defineComponent({
  name: "VTreeView",
  inheritAttrs: false,
  props: {
    model: { type: Object as PropType<object | null>, default: null },
    headersVisible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    reorderable: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { element, expose: handle } = useElement();
    const pending = new Set<InstanceType<typeof Gtk.TreeViewColumn>>();
    const attached = new Set<InstanceType<typeof Gtk.TreeViewColumn>>();
    let mountedView: InstanceType<typeof Gtk.TreeView> | null = null;
    const view = () =>
      (element.value?.widget as InstanceType<typeof Gtk.TreeView> | undefined) ??
      mountedView ??
      undefined;
    const flush = () => {
      const treeView = view();
      if (!treeView) return;
      for (const column of pending) {
        treeView.appendColumn(column);
        attached.add(column);
      }
      pending.clear();
    };
    const api: TreeViewApi = {
      add(column) {
        pending.add(column);
        flush();
      },
      remove(column) {
        pending.delete(column);
        const treeView = view();
        if (treeView && attached.has(column)) {
          treeView.removeColumn(column);
          attached.delete(column);
        }
      },
    };
    provide(treeViewKey, api);
    onMounted(() => {
      mountedView =
        (element.value?.widget as InstanceType<typeof Gtk.TreeView> | undefined) ?? null;
      flush();
    });
    onUnmounted(() => {
      const treeView = view();
      if (treeView) treeView.setModel(null);
      attached.clear();
      pending.clear();
    });
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get columns() {
        return view()?.getColumns() ?? [];
      },
    });
    return () =>
      h(
        "tree-view",
        {
          ...attrs,
          ref: element,
          model: props.model,
          ...(props.headersVisible === undefined ? {} : { headersVisible: props.headersVisible }),
          ...(props.reorderable === undefined ? {} : { reorderable: props.reorderable }),
        },
        slots.columns?.(),
      );
  },
});

export const VTreeViewColumn = defineComponent({
  name: "VTreeViewColumn",
  props: {
    title: { type: String as PropType<string | undefined>, default: undefined },
    expand: { type: Boolean, default: false },
    resizable: { type: Boolean, default: false },
    sortColumnId: { type: Number, default: -1 },
    minWidth: { type: Number, default: -1 },
  },
  setup(props, { slots, expose }) {
    const column = new Gtk.TreeViewColumn();
    const refresh = () => {
      column.title = props.title ?? "";
      column.setExpand(props.expand);
      column.setResizable(props.resizable);
      column.setSortColumnId(props.sortColumnId);
      if (props.minWidth >= 0) column.setMinWidth(props.minWidth);
    };
    refresh();
    watch(
      () =>
        [props.title, props.expand, props.resizable, props.sortColumnId, props.minWidth] as const,
      refresh,
      { flush: "post" },
    );
    const api: TreeColumnApi = {
      pack(renderer) {
        column.packStart(renderer, true);
      },
      attribute(renderer, attribute, modelColumn) {
        if (modelColumn >= 0) column.addAttribute(renderer, attribute, modelColumn);
      },
      clear(renderer) {
        column.clearAttributes(renderer);
      },
    };
    provide(treeColumnKey, api);
    const viewApi = inject<TreeViewApi | null>(treeViewKey, null);
    onMounted(() => viewApi?.add(column));
    onUnmounted(() => viewApi?.remove(column));
    expose({
      column,
      get widget() {
        return column;
      },
      get renderers() {
        return column.getCells();
      },
    });
    return () => slots.default?.();
  },
});

function useCellRenderer<T extends InstanceType<typeof Gtk.CellRenderer>>(
  create: () => T,
  props: { column: number; modelColumn: number; attribute: string },
) {
  const renderer = create();
  const api = inject<TreeColumnApi | null>(treeColumnKey, null);
  const modelColumn = () => (props.column >= 0 ? props.column : props.modelColumn);
  const applyAttribute = () => {
    api?.clear(renderer);
    api?.attribute(renderer, props.attribute, modelColumn());
  };
  onMounted(() => {
    api?.pack(renderer);
    applyAttribute();
  });
  watch(() => [props.column, props.modelColumn, props.attribute] as const, applyAttribute, {
    flush: "post",
  });
  onUnmounted(() => api?.clear(renderer));
  return renderer;
}

const cellColumnProps = {
  column: { type: Number, default: -1 },
  modelColumn: { type: Number, default: -1 },
};

export const VCellRendererText = defineComponent({
  name: "VCellRendererText",
  props: {
    ...cellColumnProps,
    attribute: { type: String, default: "text" },
    editable: { type: Boolean, default: false },
    xalign: { type: Number as PropType<number | undefined>, default: undefined },
  },
  emits: ["edited"],
  setup(props, { expose, emit }) {
    const renderer = useCellRenderer(() => new Gtk.CellRendererText(), props);
    const forward = (path: string, text: string) => emit("edited", path, text);
    const apply = () => {
      renderer.editable = props.editable;
      if (props.xalign !== undefined) renderer.xalign = props.xalign;
    };
    apply();
    watch(() => [props.editable, props.xalign] as const, apply, { flush: "post" });
    renderer.on("edited", forward);
    onUnmounted(() => renderer.off("edited", forward));
    expose({ renderer, widget: renderer, emitEdited: forward });
    return () => null;
  },
});

export const VCellRendererToggle = defineComponent({
  name: "VCellRendererToggle",
  props: {
    ...cellColumnProps,
    attribute: { type: String, default: "active" },
    activatable: { type: Boolean, default: true },
    radio: { type: Boolean, default: false },
  },
  emits: ["toggled"],
  setup(props, { expose, emit }) {
    const renderer = useCellRenderer(() => new Gtk.CellRendererToggle(), props);
    const forward = (path: string) => emit("toggled", path);
    const apply = () => {
      renderer.activatable = props.activatable;
      renderer.radio = props.radio;
    };
    apply();
    watch(() => [props.activatable, props.radio] as const, apply, { flush: "post" });
    renderer.on("toggled", forward);
    onUnmounted(() => renderer.off("toggled", forward));
    expose({ renderer, widget: renderer, emitToggled: forward });
    return () => null;
  },
});

export const VCellRendererPixbuf = defineComponent({
  name: "VCellRendererPixbuf",
  props: {
    ...cellColumnProps,
    attribute: { type: String, default: "pixbuf" },
  },
  setup(props, { expose }) {
    const renderer = useCellRenderer(() => new Gtk.CellRendererPixbuf(), props);
    expose({ renderer, widget: renderer });
    return () => null;
  },
});

/**
 * Build a `Gtk.TreeListModel` over a flat `Gio.ListModel`. The result is a `Gio.ListModel` (GTK
 * 4.24 does not implement `Gtk.TreeModel` on it), so pass it to a `VColumnView` through a
 * selection; `VTreeView` keeps taking a real `Gtk.TreeModel`.
 */
export function createTreeListModel(
  listStore: object,
  childrenFunc: (item: object | null) => object | null = () => null,
): InstanceType<typeof Gtk.TreeListModel> {
  return Gtk.TreeListModel.new(
    listStore as InstanceType<typeof Gio.ListStore>,
    false,
    false,
    (item) => childrenFunc(item as object | null) as InstanceType<typeof Gio.ListStore> | null,
  );
}

/* Small local helpers shared by the role-based panels above. */

function flatten(slot?: Slot): VNodeChild[] {
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

/** One role wrapper per slot item, keyed by the item key so reorders keep wrapper identity. */
function slotWrapper(role: string, item: VNodeChild, index: number): VNode {
  const explicit = isVNode(item) ? item.key : undefined;
  const key = `${role}:${explicit == null ? `index:${index}` : String(explicit)}`;
  return h("box", { role, key, "slot-container": true }, [item]);
}
