import Gtk from "gi:Gtk-4.0";

/** The version of the GTK typelib loaded by node-gtk. */
function gtkVersion(): { major: number; minor: number } {
  return { major: Gtk.getMajorVersion(), minor: Gtk.getMinorVersion() };
}

/** True when the loaded GTK is at least `major.minor`. */
export function supportsGtkVersion(major: number, minor: number): boolean {
  const current = gtkVersion();
  return current.major > major || (current.major === major && current.minor >= minor);
}

function unsupported(component: string, major: number, minor: number): Error {
  const current = gtkVersion();
  return new Error(
    `vio: ${component} requires GTK ${major}.${minor}+ (found ${current.major}.${current.minor})`,
  );
}

/** Check a version floor before a newer-GTK widget or method is used. */
export function requireGtkVersion(component: string, major: number, minor: number): void {
  if (!supportsGtkVersion(major, minor)) throw unsupported(component, major, minor);
}

/**
 * Construct a Gtk class that older typings do not declare. The runtime version and the actual
 * presence of the class are both checked, so a missing symbol becomes a clear vio error instead
 * of a `ReferenceError` or `undefined is not a constructor`.
 */
export function createGtkClass<T extends object>(
  component: string,
  className: string,
  major: number,
  minor: number,
): T {
  const constructor = (Gtk as unknown as Record<string, unknown>)[className];
  if (!supportsGtkVersion(major, minor) || typeof constructor !== "function")
    throw unsupported(component, major, minor);
  return new (constructor as new () => object)() as T;
}

/** Resolve an instance method that older typings do not declare, with the same feature check. */
export function requireGtkMethod<T extends (...args: never[]) => unknown>(
  component: string,
  method: T | undefined,
  major: number,
  minor: number,
): T {
  if (!supportsGtkVersion(major, minor) || typeof method !== "function")
    throw unsupported(component, major, minor);
  return method;
}
