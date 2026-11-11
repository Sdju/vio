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
 * `Gtk.FontDialog::choose()`, while 4.22 creates or realizes it only after the main context has
 * iterated. The chooser can also exist before its incremental font list has loaded, so a
 * description set too early is dropped. Watch the toplevels and re-apply the description until a
 * chooser reports a selected font. Returns a disposer for the watch.
 */
export function applyFontSelectionWhenReady(
  parent: NativeWidget,
  description: FontDescription,
): () => void {
  let attempts = 0;
  let finished = false;
  const source = GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 20, () => {
    console.error(`[vio-debug] tick ${attempts} toplevels ${Gtk.Window.listToplevels().length}`);
    if (attempts++ >= 100) {
      finished = true;
      return GLib.SOURCE_REMOVE;
    }
    let selected = false;
    for (const window of Gtk.Window.listToplevels()) {
      if (window === parent) continue;
      const chooser = findFontChooser(window);
      if (!chooser) continue;
      ensureFontSelection(chooser, description);
      selected ||= Boolean(chooser.getFont());
    }
    if (!selected) return GLib.SOURCE_CONTINUE;
    finished = true;
    return GLib.SOURCE_REMOVE;
  });
  return () => {
    if (!finished) GLib.sourceRemove(source);
  };
}
