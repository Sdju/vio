import Gtk from "gi:Gtk-4.0";
import Gdk from "gi:Gdk-4.0";
import Pango from "gi:Pango-1.0";
import { markRaw, normalizeClass, normalizeStyle } from "@vue/runtime-core";
import { toKebab, type VioDriver, type VioElement, type VioNode } from "../renderer/index.ts";
import type { NativeObject, Widget } from "../renderer/index.ts";
import {
  hasGtkClass,
  introspectedTypeOf,
  resolveIntrospected,
  suggestIntrospectedTypes,
} from "./introspected.ts";
import type { ChildrenMode, WidgetDefinition } from "./types.ts";

export type { ChildrenMode, Placement, WidgetDefinition } from "./types.ts";

const childrenModes = new Set<string>(["none", "box", "single", "list", "grid", "stack", "text"]);
/**
 * `KeepAlive` asks the renderer for a `div` storage container. A GTK tree has no DOM, so the
 * renderer maps that one internal name to a detached `Gtk.Box`; applications do not need to
 * register a dummy widget themselves.
 */
const storageDefinition: WidgetDefinition = { create: () => new Gtk.Box(), children: "box" };

const definitions = new Map<string, WidgetDefinition>([
  [
    "window",
    {
      create: () => new Gtk.Window(),
      children: "single",
      insertChild({ parent, parentWidget, child, role }) {
        if (role === "titlebar") {
          (parentWidget as InstanceType<typeof Gtk.Window>).setTitlebar(child);
          return;
        }
        const content = concreteChildren(parent).filter((node) => node.props.role !== "titlebar");
        if (content.length > 1)
          throw new Error(`vio: 'window' accepts one widget child; wrap siblings in VBox`);
        (parentWidget as InstanceType<typeof Gtk.Window>).setChild(child);
      },
      removeChild({ parentWidget, child, role }) {
        const window = parentWidget as InstanceType<typeof Gtk.Window>;
        if (role === "titlebar") {
          if (window.getTitlebar() === child) window.setTitlebar(null);
          return;
        }
        if (window.getChild() === child) window.setChild(null);
      },
    },
  ],
  ["box", { create: () => new Gtk.Box(), children: "box" }],
  ["label", { create: () => new Gtk.Label(), children: "text" }],
  ["entry", { create: () => new Gtk.Entry() }],
  ["button", { create: () => new Gtk.Button(), children: "single" }],
  ["image", { create: () => new Gtk.Image() }],
  ["list-box", { create: () => new Gtk.ListBox(), children: "list" }],
  ["list-box-row", { create: () => new Gtk.ListBoxRow(), children: "single" }],
  ["scrolled-window", { create: () => new Gtk.ScrolledWindow(), children: "single" }],
  ["grid", { create: () => new Gtk.Grid(), children: "grid" }],
  ["stack", { create: () => new Gtk.Stack(), children: "stack" }],
  ["separator", { create: () => new Gtk.Separator() }],
  ["spinner", { create: () => new Gtk.Spinner() }],
  ["switch", { create: () => new Gtk.Switch() }],
  ["check-button", { create: () => new Gtk.CheckButton(), children: "single" }],
  ["key-controller", { create: () => new Gtk.EventControllerKey(), controller: true }],
]);
const lookup = (type: string): WidgetDefinition | undefined =>
  definitions.get(type) ?? (type === "div" ? storageDefinition : resolveIntrospected(type));

const toCamel = (key: string) =>
  key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * Collect the declared construct-only props under the camelCase names node-gtk accepts in a
 * constructor. Templates keep kebab-case keys for native elements, while `h()` usually passes
 * camelCase; both spellings are accepted.
 */
function constructorProps(
  definition: WidgetDefinition,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!definition.constructProps?.length || !props) return undefined;
  const result: Record<string, unknown> = {};
  for (const name of definition.constructProps) {
    const camel = toCamel(name);
    const value = props[camel] ?? props[name];
    if (value !== undefined && value !== null) result[camel] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

/** True when a kebab-case property is construct-only for this definition. */
const isConstructProp = (definition: WidgetDefinition | undefined, property: string) =>
  definition?.constructProps?.includes(property) ?? false;

/** Extend vio with an introspected GTK/Adwaita class without changing its reconciler. */
export function registerWidget(type: string, definition: WidgetDefinition) {
  if (definitions.has(type)) throw new Error(`vio: widget '${type}' is already registered`);
  if (definition.children !== undefined && !childrenModes.has(definition.children))
    throw new Error(`vio: unknown children mode '${definition.children}' for '${type}'`);
  for (const hook of ["insertChild", "removeChild"] as const)
    if (definition[hook] !== undefined && typeof definition[hook] !== "function")
      throw new Error(`vio: '${type}' ${hook} must be a function`);
  if (
    definition.constructProps !== undefined &&
    (!Array.isArray(definition.constructProps) ||
      !definition.constructProps.every((name) => typeof name === "string"))
  )
    throw new Error(`vio: '${type}' constructProps must be an array of property names`);
  definitions.set(type, definition);
}

/** True when `registerWidget()` already defined `type`. */
export function hasWidget(type: string): boolean {
  return definitions.has(type);
}

/** The stored definition, or `undefined`; useful for idempotent wrapper libraries. */
export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return definitions.get(type);
}

/** Registered widget type names, in registration order. Diagnostic helper. */
export function getWidgetTypes(): string[] {
  return [...definitions.keys()];
}

export function installCss(css: string): () => void {
  const display = Gdk.Display.getDefault();
  if (!display)
    throw new Error("vio: GTK has no display; call Gtk.init() in a desktop session first");
  const provider = new Gtk.CssProvider();
  // GTK otherwise logs parsing errors and continues with a partially applied sheet.
  let parsingError: Error | undefined;
  provider.on("parsing-error", (_section: unknown, error: Error) => {
    parsingError = error;
  });
  provider.loadFromString(css);
  if (parsingError) throw new Error(`vio: invalid GTK CSS: ${parsingError.message}`);
  Gtk.StyleContext.addProviderForDisplay(
    display,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
  return () => Gtk.StyleContext.removeProviderForDisplay(display, provider);
}

interface State {
  defaults: Map<string, unknown>;
  classes: Set<string>;
  originalClasses: Set<string>;
  removeStyle?: () => void;
  styleId?: string;
}
const states = new WeakMap<VioNode, State>();
let styleCounter = 0;
const native = (node: VioNode) => node.widget as NativeObject;
const widget = (node: VioNode) => node.widget as Widget;
const stateOf = (node: VioNode) => {
  let state = states.get(node);
  if (!state) {
    state = {
      defaults: new Map(),
      classes: new Set(),
      originalClasses: new Set(
        node.widget instanceof Gtk.Widget ? node.widget.getCssClasses() : [],
      ),
    };
    states.set(node, state);
  }
  return state;
};
const rootTypes: Array<[Function, string]> = [
  [Gtk.Box, "box"],
  [Gtk.ListBox, "list-box"],
  [Gtk.Grid, "grid"],
  [Gtk.Stack, "stack"],
  [Gtk.Notebook, "vio-notebook"],
  [Gtk.Paned, "vio-paned"],
  [Gtk.Overlay, "vio-overlay"],
  [Gtk.CenterBox, "vio-center-box"],
  [Gtk.HeaderBar, "vio-header-bar"],
  [Gtk.FlowBox, "vio-flow-box"],
  [Gtk.Fixed, "vio-fixed"],
];
const definitionOf = (node: VioElement): WidgetDefinition | undefined => {
  if (node.kind !== "root") return lookup(node.type);
  if (node.mode) {
    const named = definitions.get(node.mode) ?? resolveIntrospected(node.mode);
    if (named) return named;
  }
  if (!node.widget) return undefined;
  for (const [type, name] of rootTypes)
    if (node.widget instanceof (type as new (...args: unknown[]) => object))
      return definitions.get(name);
  const introspected = introspectedTypeOf(node.widget);
  return introspected ? resolveIntrospected(introspected) : undefined;
};
const childMode = (node: VioElement): ChildrenMode => {
  if (node.kind !== "root") return lookup(node.type)?.children ?? "none";
  if (node.mode) {
    const definition = definitions.get(node.mode) ?? resolveIntrospected(node.mode);
    if (definition) return definition.children ?? "none";
    if (childrenModes.has(node.mode)) return node.mode as ChildrenMode;
    throw new Error(`vio: unknown root child mode '${node.mode}'`);
  }
  const definition = definitionOf(node);
  if (definition) return definition.children ?? "none";
  return node.widget ? "single" : "none";
};
const concreteChildren = (node: VioElement) =>
  node.children.filter((child) => child.widget && !lookup(child.type)?.controller);
const isController = (node: VioNode) => Boolean(lookup(node.type)?.controller);
const applySelection = (parent: VioElement) => {
  if (parent.widget instanceof Gtk.ListBox && parent.props.selected !== undefined) {
    parent.widget.selectRow(parent.widget.getRowAtIndex(Number(parent.props.selected)));
  }
};
const labelText = (parent: VioElement) =>
  (parent.widget as InstanceType<typeof Gtk.Label>).setLabel(
    parent.children.map((child) => child.text).join(""),
  );
const enumValues: Record<string, Record<string, number>> = {
  orientation: { horizontal: Gtk.Orientation.HORIZONTAL, vertical: Gtk.Orientation.VERTICAL },
  selectionMode: {
    none: Gtk.SelectionMode.NONE,
    single: Gtk.SelectionMode.SINGLE,
    browse: Gtk.SelectionMode.BROWSE,
    multiple: Gtk.SelectionMode.MULTIPLE,
  },
  halign: {
    fill: Gtk.Align.FILL,
    start: Gtk.Align.START,
    end: Gtk.Align.END,
    center: Gtk.Align.CENTER,
    baseline: Gtk.Align.BASELINE,
  },
  valign: {
    fill: Gtk.Align.FILL,
    start: Gtk.Align.START,
    end: Gtk.Align.END,
    center: Gtk.Align.CENTER,
    baseline: Gtk.Align.BASELINE,
  },
  ellipsize: {
    none: Pango.EllipsizeMode.NONE,
    start: Pango.EllipsizeMode.START,
    middle: Pango.EllipsizeMode.MIDDLE,
    end: Pango.EllipsizeMode.END,
  },
  propagationPhase: {
    none: Gtk.PropagationPhase.NONE,
    capture: Gtk.PropagationPhase.CAPTURE,
    bubble: Gtk.PropagationPhase.BUBBLE,
    target: Gtk.PropagationPhase.TARGET,
  },
  hscrollbarPolicy: {
    always: Gtk.PolicyType.ALWAYS,
    automatic: Gtk.PolicyType.AUTOMATIC,
    never: Gtk.PolicyType.NEVER,
    external: Gtk.PolicyType.EXTERNAL,
  },
  vscrollbarPolicy: {
    always: Gtk.PolicyType.ALWAYS,
    automatic: Gtk.PolicyType.AUTOMATIC,
    never: Gtk.PolicyType.NEVER,
    external: Gtk.PolicyType.EXTERNAL,
  },
};
/** node-gtk rejects `setProperty(name, null)` for object properties; use their setters. */
const nullSetters: Record<string, string> = {
  model: "setModel",
  factory: "setFactory",
  file: "setFile",
  "menu-model": "setMenuModel",
  application: "setApplication",
  settings: "setSettings",
  paintable: "setPaintable",
  "media-stream": "setMediaStream",
  dialog: "setDialog",
  permission: "setPermission",
  popover: "setPopover",
  "list-row": "setListRow",
  adjustment: "setAdjustment",
  "label-widget": "setLabelWidget",
  stylesheet: "setStylesheet",
};
const metadataProps = new Set(["role", "tab-label", "page", "slot-container"]);

/**
 * Replace a not-yet-inserted widget when a construct-only prop arrives after `createElement()`.
 * Vue's normal path passes vnode props to `createElement()`, so this is a compatibility path for
 * manually built nodes and for renderers that create elements before their props are known.
 */
function recreateWidget(node: VioElement, definition: WidgetDefinition) {
  const previous = node.widget;
  const state = states.get(node);
  state?.removeStyle?.();
  states.delete(node);
  node.widget = markRaw(definition.create(constructorProps(definition, node.props)));
  if (previous instanceof Gtk.Widget && node.widget instanceof Gtk.Widget)
    for (const name of previous.getCssClasses()) node.widget.addCssClass(name);
  // The old disconnect closures still point at the replaced native object.
  for (const binding of node.events.values()) {
    binding.disconnect();
    binding.disconnect = gtkDriver.connect(node, binding.signal, binding.callback);
  }
  for (const [prop, value] of Object.entries(node.props)) {
    if (/^on[^a-z]/.test(prop) || metadataProps.has(prop)) continue;
    if (isConstructProp(definition, toKebab(toCamel(prop)))) continue;
    gtkDriver.patchProp(node, prop, undefined, value);
  }
}

let mountDepth = 0;
const pendingVisible = new Set<VioNode>();

const flushVisibleWindows = () => {
  for (const node of pendingVisible) {
    if (node.widget instanceof Gtk.Window) native(node).setProperty("visible", true);
  }
  pendingVisible.clear();
};

export const gtkDriver: VioDriver = {
  isAnchor: (node) => !isController(node),
  beginMount() {
    mountDepth++;
  },
  endMount() {
    if (mountDepth > 0) mountDepth--;
    if (mountDepth === 0) flushVisibleWindows();
  },
  create(type, props) {
    const definition = lookup(type);
    if (!definition) {
      if (hasGtkClass(type)) throw new Error(`vio: '${type}' is not a Gtk.Widget`);
      const suggestions = suggestIntrospectedTypes(type);
      throw new Error(
        `vio: unknown widget '${type}'; no such Gtk class. Did you mean ${suggestions.join(", ")}?`,
      );
    }
    return definition.create(constructorProps(definition, props));
  },
  createText: (text) => new Gtk.Label({ label: text, xalign: 0 }),
  insert(node, parent, before) {
    if (parent.kind === "root" && !parent.widget) {
      if (isController(node)) throw new Error("vio: an event controller must belong to a widget");
      return;
    }
    if (isController(node)) {
      if (!(parent.widget instanceof Gtk.Widget))
        throw new Error("vio: controller parent is not a Gtk.Widget");
      const controller = node.widget as InstanceType<typeof Gtk.EventController>;
      if (controller.getWidget() !== parent.widget) parent.widget.addController(controller);
      return;
    }
    const role = typeof node.props.role === "string" ? node.props.role : null;
    const definition = definitionOf(parent);
    if (definition?.insertChild) {
      definition.insertChild({
        parent,
        parentWidget: parent.widget as InstanceType<typeof Gtk.Widget>,
        child: node.widget as InstanceType<typeof Gtk.Widget>,
        node,
        role,
        before: role ? null : (before as InstanceType<typeof Gtk.Widget> | null),
        index: concreteChildren(parent).indexOf(node),
      });
      return;
    }
    const mode = childMode(parent);
    if (mode === "text") {
      if (node.kind !== "text") throw new Error("vio: labels accept text, not nested GTK widgets");
      labelText(parent);
      return;
    }
    if (mode === "none") throw new Error(`vio: '${parent.type}' cannot contain children`);
    const child = node.widget as InstanceType<typeof Gtk.Widget>;
    if (mode === "box") {
      const box = parent.widget as InstanceType<typeof Gtk.Box>;
      const children = concreteChildren(parent);
      const position = children.indexOf(node);
      const previous =
        position > 0 ? (children[position - 1]!.widget as InstanceType<typeof Gtk.Widget>) : null;
      if (child.getParent() === box) box.reorderChildAfter(child, previous);
      else box.insertChildAfter(child, previous);
    } else if (mode === "list") {
      if (!(child instanceof Gtk.ListBoxRow))
        throw new Error("vio: VListBox children must be VListBoxRow components");
      const list = parent.widget as InstanceType<typeof Gtk.ListBox>;
      if (child.getParent() === list) list.remove(child);
      const index = before ? (before as InstanceType<typeof Gtk.ListBoxRow>).getIndex() : -1;
      list.insert(child, index);
      applySelection(parent);
    } else if (mode === "single") {
      if (concreteChildren(parent).length > 1)
        throw new Error(`vio: '${parent.type}' accepts one widget child; wrap siblings in VBox`);
      (parent.widget as InstanceType<typeof Gtk.Window>).setChild(child);
    } else if (mode === "grid") {
      const grid = parent.widget as InstanceType<typeof Gtk.Grid>;
      if (child.getParent() === grid) grid.remove(child);
      grid.attach(
        child,
        Number(node.props.column ?? 0),
        Number(node.props.row ?? concreteChildren(parent).indexOf(node)),
        Number(node.props.columnSpan ?? 1),
        Number(node.props.rowSpan ?? 1),
      );
    } else if (mode === "stack") {
      const stack = parent.widget as InstanceType<typeof Gtk.Stack>;
      if (child.getParent() !== stack)
        stack.addNamed(
          child,
          String(node.props.name ?? `page-${concreteChildren(parent).indexOf(node)}`),
        );
    }
  },
  remove(node, parent) {
    if (parent.kind === "root" && !parent.widget) return;
    if (isController(node)) {
      (parent.widget as InstanceType<typeof Gtk.Widget>).removeController(
        node.widget as InstanceType<typeof Gtk.EventController>,
      );
      return;
    }
    const role = typeof node.props.role === "string" ? node.props.role : null;
    const definition = definitionOf(parent);
    if (definition?.removeChild) {
      definition.removeChild({
        parent,
        parentWidget: parent.widget as InstanceType<typeof Gtk.Widget>,
        child: node.widget as InstanceType<typeof Gtk.Widget>,
        node,
        role,
        before: null,
        index: concreteChildren(parent).indexOf(node),
      });
      return;
    }
    const mode = childMode(parent);
    if (mode === "text") {
      (parent.widget as InstanceType<typeof Gtk.Label>).setLabel(
        parent.children
          .filter((child) => child !== node)
          .map((child) => child.text)
          .join(""),
      );
      return;
    }
    const child = node.widget as InstanceType<typeof Gtk.Widget>;
    if (!child.getParent()) return;
    if (mode === "single") (parent.widget as InstanceType<typeof Gtk.Window>).setChild(null);
    else if (mode === "box") (parent.widget as InstanceType<typeof Gtk.Box>).remove(child);
    else if (mode === "list") (parent.widget as InstanceType<typeof Gtk.ListBox>).remove(child);
    else if (mode === "grid") (parent.widget as InstanceType<typeof Gtk.Grid>).remove(child);
    else if (mode === "stack") (parent.widget as InstanceType<typeof Gtk.Stack>).remove(child);
  },
  patchProp(node, key, _previous, value) {
    const state = stateOf(node);
    if (key === "class") {
      const classes = new Set(normalizeClass(value).split(/\s+/).filter(Boolean));
      for (const name of state.classes)
        if (!classes.has(name) && !state.originalClasses.has(name))
          widget(node).removeCssClass(name);
      for (const name of classes) if (!state.classes.has(name)) widget(node).addCssClass(name);
      state.classes = classes;
      return;
    }
    if (key === "style") {
      state.removeStyle?.();
      state.removeStyle = undefined;
      if (value) {
        state.styleId ??= `vio-style-${++styleCounter}`;
        widget(node).addCssClass(state.styleId);
        const style = normalizeStyle(value);
        const css =
          typeof style === "string"
            ? style
            : Object.entries(style ?? {})
                .map(([name, value]) => `${toKebab(name)}: ${value}`)
                .join("; ");
        state.removeStyle = installCss(`.${state.styleId} { ${css} }`);
      }
      return;
    }
    if (key === "selected" && node.type === "list-box") {
      applySelection(node);
      return;
    }
    if (key === "visible" && node.widget instanceof Gtk.Window) {
      // Vue normally mounts children before props. If a future order patches `visible` first,
      // hold presentation until the subtree exists so the titlebar is installed pre-realization.
      if (value === true && mountDepth > 0 && node.children.length === 0) {
        pendingVisible.add(node);
        return;
      }
      pendingVisible.delete(node);
    }
    if (metadataProps.has(key)) return;
    if ((key === "x" || key === "y") && node.parent && node.parent.widget instanceof Gtk.Fixed) {
      gtkDriver.insert(node, node.parent, null);
      return;
    }
    if (["column", "row", "columnSpan", "rowSpan"].includes(key)) {
      if (node.parent && childMode(node.parent) === "grid")
        gtkDriver.insert(node, node.parent, null);
      return;
    }
    const camelKey = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (typeof value === "string" && enumValues[camelKey]) {
      if (!(value in enumValues[camelKey]!))
        throw new Error(`vio: unknown ${key} value '${value}'`);
      value = enumValues[camelKey]![value];
    }
    const property = key === "id" ? "name" : toKebab(camelKey);
    const definition = definitionOf(node);
    if (isConstructProp(definition, property)) {
      // The normal path already passed this value to createElement(); skip a repeated setProperty,
      // which GTK would report as a GLib-GObject-CRITICAL. A real change is rejected explicitly.
      if (value == null || Object.is(native(node).getProperty(property), value)) return;
      const wasConstructed = node.constructed?.has(key) || node.constructed?.has(property) || false;
      const constructed = node.constructed?.get(key) ?? node.constructed?.get(property);
      if (wasConstructed && Object.is(constructed, value)) return;
      if (node.parent)
        throw new Error(
          `vio: '${node.type}' property '${property}' is construct-only and cannot change after the widget is inserted`,
        );
      recreateWidget(node, definition!);
      return;
    }
    if (!state.defaults.has(property))
      state.defaults.set(property, native(node).getProperty(property));
    const next = value == null ? state.defaults.get(property) : value;
    if (next == null) {
      const setter = nullSetters[property];
      if (setter) {
        const method = (native(node) as unknown as Record<string, unknown>)[setter];
        if (typeof method === "function") {
          if (native(node).getProperty(property) != null)
            (method as (value: null) => void).call(native(node), null);
          return;
        }
      }
    }
    if (native(node).getProperty(property) !== next) native(node).setProperty(property, next);
  },
  setText(node, text) {
    (node.widget as InstanceType<typeof Gtk.Label>).setLabel(text);
    if (node.parent && childMode(node.parent) === "text") labelText(node.parent);
  },
  setElementText(node, text) {
    if (
      node.widget instanceof Gtk.Label ||
      node.widget instanceof Gtk.Button ||
      node.widget instanceof Gtk.CheckButton
    ) {
      node.widget.setLabel(text);
      return true;
    }
    return false;
  },
  connect(node, signal, callback) {
    native(node).on(signal, callback);
    return () => {
      if (node.widget) native(node).off(signal, callback);
    };
  },
  setScopeId: (node, id) => {
    if (node.widget instanceof Gtk.Widget) node.widget.addCssClass(id);
  },
  dispose(node) {
    states.get(node)?.removeStyle?.();
    states.delete(node);
    if (node.widget instanceof Gtk.Window) {
      const window = node.widget;
      pendingVisible.delete(node);
      const titlebar = window.getTitlebar();
      if (window.getChild()) window.setChild(null);
      // GTK warns when the titlebar changes on a realized window. Destroy first, then clear the
      // now-unrealized titlebar slot, so unmounting a visible window stays warning-free.
      window.destroy();
      if (titlebar) window.setTitlebar(null);
    }
  },
};
