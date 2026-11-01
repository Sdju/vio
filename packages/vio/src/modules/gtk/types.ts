import type Gtk from "gi:Gtk-4.0";
import type { VioElement, VioNode } from "../renderer/index.ts";

export type ChildrenMode = "none" | "box" | "single" | "list" | "grid" | "stack" | "text";

/** Everything a placement hook needs; `role` comes from `node.props.role`. */
export interface Placement {
  parent: VioElement;
  parentWidget: InstanceType<typeof Gtk.Widget>;
  child: InstanceType<typeof Gtk.Widget>;
  node: VioNode;
  /** `node.props.role`, or `null` when the child has no role marker. */
  role: string | null;
  /** Next sibling widget, unless the child has a role; role slots ignore anchors. */
  before: InstanceType<typeof Gtk.Widget> | null;
  /** Index among widget-backed, non-controller children of `parent`. */
  index: number;
}

export interface WidgetDefinition {
  /**
   * Build the native object. `props` contains the construct-only properties declared by
   * `constructProps`, keyed by their camelCase node-gtk constructor names. Definitions that need
   * no constructor properties keep using `create: () => new Gtk.X()`.
   */
  create: (props?: Record<string, unknown>) => object;
  children?: ChildrenMode;
  controller?: boolean;
  /**
   * Kebab-case property names that GTK accepts only in the constructor (`GParamFlags.CONSTRUCT_ONLY`).
   * They are passed to `create()` at element creation; later changes are rejected instead of
   * reaching `setProperty()` and logging `GLib-GObject-CRITICAL`.
   */
  constructProps?: string[];
  /** Container-specific placement; runs before the `children` switch. */
  insertChild?: (placement: Placement) => void;
  /** Container-specific removal; must be safe to call more than once. */
  removeChild?: (placement: Placement) => void;
}
