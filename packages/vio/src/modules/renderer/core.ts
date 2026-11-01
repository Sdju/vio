import {
  createRenderer,
  markRaw,
  callWithAsyncErrorHandling,
  type ComponentInternalInstance,
} from "@vue/runtime-core";

export interface VioNode {
  kind: "root" | "element" | "text" | "comment";
  type: string;
  widget: object | null;
  parent: VioElement | null;
  children: VioNode[];
  props: Record<string, unknown>;
  text: string;
  patching: number;
  events: Map<string, SignalBinding>;
  /** Explicit child mode for a root node: a `ChildrenMode` or a registered widget type. */
  mode?: string | null;
  /** Props present when the element was created; construct-only props were applied then. */
  constructed?: Map<string, unknown>;
}
export interface VioElement extends VioNode {
  kind: "root" | "element";
}
interface SignalBinding {
  value: Function | Function[];
  instance: ComponentInternalInstance | null;
  signal: string;
  callback: (...args: unknown[]) => unknown;
  disconnect: () => void;
  once: boolean;
  fired: boolean;
}

/** Native operations are isolated so the reconciler can be tested without GTK. */
export interface VioDriver {
  isAnchor?(node: VioNode): boolean;
  /** Called before Vue mounts a subtree; windows can postpone presentation until it ends. */
  beginMount?(): void;
  /** Called after the mount subtree is complete. */
  endMount?(): void;
  create(type: string, props?: Record<string, unknown>): object;
  createText(text: string): object;
  insert(node: VioNode, parent: VioElement, before: object | null): void;
  remove(node: VioNode, parent: VioElement): void;
  patchProp(node: VioElement, key: string, previous: unknown, value: unknown): void;
  setText(node: VioNode, text: string): void;
  setElementText(node: VioElement, text: string): boolean;
  connect(node: VioElement, signal: string, callback: (...args: unknown[]) => unknown): () => void;
  setScopeId(node: VioElement, id: string): void;
  dispose(node: VioNode): void;
}

const makeNode = (kind: VioNode["kind"], type: string, widget: object | null, text = ""): VioNode =>
  markRaw({
    kind,
    type,
    widget: widget ? markRaw(widget) : null,
    parent: null,
    children: [],
    props: {},
    text,
    patching: 0,
    events: new Map(),
  });
export const createRoot = (widget: object | null = null, mode?: string): VioElement => {
  const node = makeNode("root", "root", widget) as VioElement;
  if (mode !== undefined) node.mode = mode;
  return node;
};
export const toKebab = (value: string) =>
  value.replace(/[A-Z]/g, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`);

const namedRoots = new Map<string, VioElement>();
const normalizeRootName = (name: string) => (name.startsWith("#") ? name.slice(1) : name);

/**
 * Name a root so a string Teleport target can find it: `registerRoot("sidebar", root)` enables
 * `<Teleport to="#sidebar">`. Returns an idempotent cleanup function.
 */
export function registerRoot(name: string, root: VioElement): () => void {
  const key = normalizeRootName(name);
  if (!key) throw new Error("vio: root name must not be empty");
  const existing = namedRoots.get(key);
  if (existing && existing !== root) throw new Error(`vio: root '${key}' is already registered`);
  namedRoots.set(key, root);
  return () => {
    if (namedRoots.get(key) === root) namedRoots.delete(key);
  };
}
/** Remove a named root; returns whether it existed. */
export function unregisterRoot(name: string): boolean {
  return namedRoots.delete(normalizeRootName(name));
}
/** Resolve a named root (`"name"` or `"#name"`). */
export function getRoot(name: string): VioElement | undefined {
  return namedRoots.get(normalizeRootName(name));
}
/** Registered root names, for diagnostics. */
export function getRootNames(): string[] {
  return [...namedRoots.keys()];
}
/** `querySelector` for the renderer: only simple `#name` root selectors are supported. */
export function queryRoot(selector: string): VioElement | null {
  const match = /^#([^\s>+~.[\]:]+)$/.exec(selector.trim());
  return match ? (namedRoots.get(match[1]!) ?? null) : null;
}

export function createVioRenderer(driver: VioDriver) {
  function nextNative(node: VioNode): object | null {
    const siblings = node.parent?.children ?? [];
    for (let index = siblings.indexOf(node) + 1; index < siblings.length; index++) {
      const sibling = siblings[index]!;
      if (sibling.widget && (driver.isAnchor?.(sibling) ?? true)) return sibling.widget;
    }
    return null;
  }
  function detach(node: VioNode) {
    if (!node.parent) return;
    const parent = node.parent;
    if (node.widget) driver.remove(node, parent);
    parent.children.splice(parent.children.indexOf(node), 1);
    node.parent = null;
  }
  function dispose(node: VioNode) {
    // Disconnect first: destroying a window can emit activation/focus signals.
    for (const binding of node.events.values()) binding.disconnect();
    node.events.clear();
    for (const child of node.children) dispose(child);
    driver.dispose(node);
    node.widget = null;
    node.children = [];
    node.parent = null;
  }
  function remove(node: VioNode) {
    detach(node);
    dispose(node);
  }
  function insert(node: VioNode, parent: VioElement, anchor: VioNode | null = null) {
    if (node === anchor) return;
    if (anchor && anchor.parent !== parent)
      throw new Error("vio: insertion anchor belongs to another parent");
    if (node.parent === parent) parent.children.splice(parent.children.indexOf(node), 1);
    else detach(node);
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    parent.children.splice(index, 0, node);
    node.parent = parent;
    if (node.widget) driver.insert(node, parent, nextNative(node));
  }
  function createText(text: string): VioNode {
    return makeNode("text", "label", text ? driver.createText(text) : null, text);
  }
  const renderer = createRenderer<VioNode, VioElement>({
    createElement(type, _namespace, _customizedBuiltIn, props) {
      const node = makeNode(
        "element",
        type.replace(/^gtk-/, ""),
        driver.create(type.replace(/^gtk-/, ""), props ?? undefined),
      ) as VioElement;
      if (props) node.constructed = new Map(Object.entries(props));
      return node;
    },
    createText,
    createComment: (text) => makeNode("comment", "comment", null, text),
    insert,
    remove,
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    setText(node, text) {
      node.text = text;
      if (!text) {
        if (node.widget && node.parent) driver.remove(node, node.parent);
        driver.dispose(node);
        node.widget = null;
      } else if (node.widget) driver.setText(node, text);
      else {
        node.widget = markRaw(driver.createText(text));
        if (node.parent) driver.insert(node, node.parent, nextNative(node));
      }
    },
    setElementText(node, text) {
      for (const child of [...node.children]) remove(child);
      node.text = text;
      if (!driver.setElementText(node, text) && text) insert(createText(text), node);
    },
    setScopeId: (node, id) => driver.setScopeId(node, id),
    querySelector: queryRoot,
    patchProp(node, key, previous, value, _namespace, instance) {
      node.props[key] = value;
      if (/^on[^a-z]/.test(key)) {
        const existing = node.events.get(key);
        if (!value) {
          existing?.disconnect();
          node.events.delete(key);
          return;
        }
        if (
          typeof value !== "function" &&
          !(Array.isArray(value) && value.every((handler) => typeof handler === "function"))
        ) {
          throw new TypeError(`vio: ${key} must be a function or array of functions`);
        }
        if (existing) {
          existing.value = value;
          existing.instance = instance ?? null;
          return;
        }
        const once = key.endsWith("Once");
        const signal = toKebab(key.slice(2, once ? -4 : undefined));
        const binding: SignalBinding = {
          value,
          instance: instance ?? null,
          signal,
          callback: (...args) => {
            if (node.patching || (binding.once && binding.fired)) return undefined;
            binding.fired = true;
            // Vue errorHandler/lifecycle context still applies to native signals.
            const result = callWithAsyncErrorHandling(binding.value, binding.instance, 5, args);
            if (Array.isArray(result))
              return result.some((value) => value === true) ? true : result.at(-1);
            return result;
          },
          once,
          fired: false,
          disconnect: () => {},
        };
        binding.disconnect = driver.connect(node, signal, binding.callback);
        node.events.set(key, binding);
      } else {
        node.patching++;
        try {
          driver.patchProp(node, key, previous, value);
        } finally {
          node.patching--;
        }
      }
    },
  });
  return { ...renderer, createRoot, createApp: withMountHooks(renderer.createApp, driver) };
}

/**
 * Window presentation can only be requested after the whole subtree exists: GTK rejects
 * `setTitlebar()` on a realized window, and Vue may patch props before or after children.
 */
function withMountHooks<T extends (...args: never[]) => { mount: (...args: never[]) => unknown }>(
  createApp: T,
  driver: VioDriver,
): T {
  return ((...args: Parameters<T>) => {
    const app = createApp(...args);
    const mount = app.mount;
    app.mount = ((...mountArgs: Parameters<typeof mount>) => {
      driver.beginMount?.();
      try {
        return mount(...mountArgs);
      } finally {
        driver.endMount?.();
      }
    }) as typeof app.mount;
    return app;
  }) as T;
}
