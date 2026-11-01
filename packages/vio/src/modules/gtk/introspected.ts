import Gtk from "gi:Gtk-4.0";
import type { WidgetDefinition } from "./types.ts";

/**
 * Only these Gtk containers install their single child through `setChild()`. The table is an
 * explicit allowlist: a container is not inferred from methods such as `append()` or `packStart()`,
 * because for `ComboBoxText`, `TreeView`, `IconView` or `CellView` those methods insert items,
 * columns or cells rather than child widgets.
 */
const singleChildTypes = new Set([
  "frame",
  "aspect-frame",
  "expander",
  "revealer",
  "viewport",
  "search-bar",
  "dialog",
  "message-dialog",
  "about-dialog",
  "application-window",
  "shortcuts-window",
  // Verified against GTK 4.24: each class accepts exactly one widget through `setChild()`.
  // `Gtk.DragIcon` is intentionally absent: `setChild()` realizes the icon and crashes without a
  // drag surface. `Gtk.ScaleButton` has no `setChild()` at all.
  "toggle-button",
  "link-button",
  "menu-button",
  "popover",
  "popover-menu",
  "tree-expander",
  "window-handle",
  "flow-box-child",
  "graphics-offload",
  "lock-button",
  "emoji-chooser",
  "assistant",
  "file-chooser-dialog",
  "color-chooser-dialog",
  "font-chooser-dialog",
  "app-chooser-dialog",
  "print-unix-dialog",
  "page-setup-unix-dialog",
]);

/** `popover-menu` -> `PopoverMenu`; acronym classes are found through the kebab map instead. */
const toPascal = (type: string) =>
  type
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");

/** `GLArea` -> `gl-area`, `ColorDialogButton` -> `color-dialog-button`. */
const toKebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

const definitionOf = (type: string): WidgetDefinition => ({
  create: () => new (widgetClasses().get(type) as new () => object)(),
  children: singleChildTypes.has(type) ? "single" : "none",
});

const definitions = new Map<string, WidgetDefinition | undefined>();
let classes: Map<string, new () => object> | undefined;

function buildClasses(): Map<string, new () => object> {
  const result = new Map<string, new () => object>();
  const namespace = Gtk as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(namespace)) {
    if (!/^[A-Z]/.test(name)) continue;
    const value = namespace[name];
    if (typeof value !== "function") continue;
    try {
      if (!(value.prototype instanceof Gtk.Widget)) continue;
    } catch {
      continue;
    }
    result.set(toKebab(name), value as new () => object);
  }
  return result;
}

function widgetClasses(): Map<string, new () => object> {
  classes ??= buildClasses();
  return classes;
}

const typeName = (type: string) => (type.startsWith("gtk-") ? type.slice(4) : type);

/** GTK's CSS node is `combobox`, so accept both spellings of the compound class name. */
const aliases = new Map([
  ["combobox", "combo-box"],
  ["combobox-text", "combo-box-text"],
]);
const normalizeType = (type: string) => aliases.get(typeName(type)) ?? typeName(type);

/** The definition for a kebab-case Gtk widget class, or `undefined` when it is not a widget. */
export function resolveIntrospected(type: string): WidgetDefinition | undefined {
  const name = normalizeType(type);
  if (!definitions.has(name))
    definitions.set(name, widgetClasses().has(name) ? definitionOf(name) : undefined);
  return definitions.get(name);
}

/** Kebab-case names of every widget class exposed by the Gtk namespace. */
export function listIntrospectedWidgetTypes(): string[] {
  return [...widgetClasses().keys()];
}

/** True when `type` names a Gtk widget class that introspection can create. */
export function isIntrospectedType(type: string): boolean {
  return widgetClasses().has(normalizeType(type));
}

/** True when the Gtk namespace has a class with this name, widget or not. */
export function hasGtkClass(type: string): boolean {
  const name = normalizeType(type);
  if (widgetClasses().has(name)) return true;
  return Object.hasOwn(Gtk, toPascal(name));
}

/** Up to five kebab-case widget names that share a prefix with `type`. */
export function suggestIntrospectedTypes(type: string): string[] {
  const name = normalizeType(type);
  const all = listIntrospectedWidgetTypes();
  const result: string[] = [];
  for (let end = name.length; end >= 2 && result.length < 5; end--) {
    const prefix = name.slice(0, end);
    for (const candidate of all)
      if (
        result.length < 5 &&
        candidate !== name &&
        candidate.startsWith(prefix) &&
        !result.includes(candidate)
      )
        result.push(candidate);
  }
  for (const candidate of all) {
    if (result.length >= 5) break;
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

/** Kebab-case introspected type of a native widget instance, or `undefined`. */
export function introspectedTypeOf(widget: object): string | undefined {
  const name = (widget as { constructor?: { name?: string } }).constructor?.name;
  if (!name) return undefined;
  const type = toKebab(name.replace(/^Gtk/, ""));
  return widgetClasses().has(type) ? type : undefined;
}
