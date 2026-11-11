import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import Pango from "gi:Pango-1.0";

type NativeWidget = InstanceType<typeof Gtk.Widget>;
type FontChooser = InstanceType<typeof Gtk.FontChooserWidget>;
type FontDescription = InstanceType<typeof Pango.FontDescription>;

export function findFontChooser(widget: NativeWidget): FontChooser | null {
  if (widget instanceof Gtk.FontChooserWidget) return widget;
  for (let child = widget.getFirstChild(); child; child = child.getNextSibling()) {
    const found = findFontChooser(child);
    if (found) return found;
  }
  return null;
}

function expandFontList(widget: NativeWidget): void {
  if (widget instanceof Gtk.ListView) {
    const selection = widget.getModel();
    const filtered = selection instanceof Gtk.SingleSelection ? selection.getModel() : null;
    const slice = filtered instanceof Gtk.FilterListModel ? filtered.getModel() : null;
    const model = slice instanceof Gtk.SliceListModel ? slice.getModel() : null;
    if (slice instanceof Gtk.SliceListModel && model) slice.setSize(model.getNItems());
  }
  for (let child = widget.getFirstChild(); child; child = child.getNextSibling())
    expandFontList(child);
}

export function ensureFontSelection(chooser: FontChooser, description: FontDescription): void {
  expandFontList(chooser);
  chooser.setFontDesc(description);
}

/**
 * GTK builds the font dialog's window lazily: GTK 4.24 has the toplevel right after
 * `Gtk.FontDialog::choose()`, while 4.22 exposes it only after the main context has iterated.
 * Watch the toplevel list for a short while and apply the description as soon as the chooser
 * exists. Returns a disposer that stops the watch when the request settles.
 */
export function applyFontSelectionWhenReady(
  previousWindows: Set<NativeWidget>,
  description: FontDescription,
): () => void {
  let attempts = 0;
  const source = GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 20, () => {
    if (attempts++ >= 100) return GLib.SOURCE_REMOVE;
    const dialog = Gtk.Window.listToplevels().find((window) => !previousWindows.has(window));
    const chooser = dialog ? findFontChooser(dialog) : null;
    if (!chooser) return GLib.SOURCE_CONTINUE;
    ensureFontSelection(chooser, description);
    return GLib.SOURCE_REMOVE;
  });
  return () => {
    GLib.sourceRemove(source);
  };
}
