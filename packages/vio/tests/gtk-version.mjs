import Gtk from "gi:Gtk-4.0";

/** The GTK version loaded by node-gtk, e.g. `4.22`. */
export const gtkVersion = `${Gtk.getMajorVersion()}.${Gtk.getMinorVersion()}`;

/** True when the loaded GTK is at least `major.minor`. */
export function supportsGtk(major, minor) {
  const currentMajor = Gtk.getMajorVersion();
  const currentMinor = Gtk.getMinorVersion();
  return currentMajor > major || (currentMajor === major && currentMinor >= minor);
}

/**
 * A `node:test` skip option for tests that exercise a newer GTK feature:
 * `await test(name, { skip: requiresGtk(4, 24) }, fn)`. CI runs GTK 4.22 on Ubuntu 26.04 while
 * the maintainer's desktop runs 4.24.1, so the version-specific expectations are asserted for the
 * runtime that is actually loaded.
 */
export function requiresGtk(major, minor) {
  return supportsGtk(major, minor)
    ? false
    : `requires GTK ${major}.${minor}+ (running ${gtkVersion})`;
}
