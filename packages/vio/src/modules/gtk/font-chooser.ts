import Gtk from "gi:Gtk-4.0";
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
