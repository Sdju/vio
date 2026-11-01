import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import GObject from "gi:GObject-2.0";
import GLib from "gi:GLib-2.0";
import { getGType } from "node-gtk";
import {
  VActionBar,
  VButton,
  VColumnView,
  VColumnViewColumn,
  VEditableLabel,
  VGridView,
  VIconView,
  VInfoBar,
  VInscription,
  VLabel,
  VSearchBar,
  VSearchEntry,
  VStatusbar,
  VTextView,
  VTreeView,
  VTreeViewColumn,
  VCellRendererText,
  VCellRendererToggle,
  VCellRendererPixbuf,
  VWindow,
  createApp,
  createTreeListModel,
  h,
  nextTick,
  ref,
  shallowRef,
} from "@zede/vio";

Gtk.init();

const pump = (iterations = 400) => {
  for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
};
const children = (widget) => {
  const result = [];
  for (let child = widget?.getFirstChild(); child; child = child.getNextSibling())
    result.push(child);
  return result;
};
const walk = (widget) => {
  const result = [];
  for (const child of children(widget)) {
    result.push(child, ...walk(child));
  }
  return result;
};
const labelsIn = (widget) => {
  const result = [];
  for (const child of walk(widget)) {
    if (typeof child.getLabel === "function") {
      const text = child.getLabel();
      if (text != null) result.push(text);
    }
  }
  return result;
};
const mount = (render) => {
  const app = createApp({ render });
  app.mount();
  return app;
};
const widgetOf = (app) => app.root.children[0].widget;
const stringStore = (values) => {
  const store = Gio.ListStore.new(getGType(Gtk.StringObject));
  for (const value of values) store.append(Gtk.StringObject.new(value));
  return store;
};
const stringTree = (values) => {
  const store = Gtk.TreeStore.new([GObject.TYPE_STRING]);
  for (const value of values) {
    const row = store.append(null);
    const cell = new GObject.Value();
    cell.init(GObject.TYPE_STRING);
    cell.setString(value);
    store.setValue(row, 0, cell);
  }
  return store;
};
const realize = async (app) => {
  const window = widgetOf(app);
  window.present();
  // Give the display a real event-loop turn so the window is mapped before the frame-clock pump;
  // tight MainContext iterations alone can finish before X11 answers.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  pump();
  return window;
};
const cellLabels = (view, header = "Name") => labelsIn(view).filter((label) => label !== header);

await test("VColumnView renders rows and patches cell content reactively", async () => {
  const store = stringStore(["alpha", "beta", "gamma"]);
  const suffix = ref("!");
  const selected = ref(0);
  let column;
  const app = mount(() =>
    h(
      VWindow,
      { defaultWidth: 480, defaultHeight: 320 },
      {
        default: () =>
          h(
            VColumnView,
            {
              model: store,
              selected: selected.value,
              showRowSeparators: true,
              reorderable: true,
              "onUpdate:selected": (value) => (selected.value = value),
            },
            {
              columns: () =>
                h(
                  VColumnViewColumn,
                  {
                    ref: (value) => (column = value),
                    title: "Name",
                    expand: true,
                  },
                  {
                    cell: ({ item, position }) =>
                      h(VLabel, null, {
                        default: () => `${position}:${item?.getString()}${suffix.value}`,
                      }),
                  },
                ),
            },
          ),
      },
    ),
  );
  try {
    const view = (await realize(app)).getChild();
    assert.ok(view instanceof Gtk.ColumnView);
    assert.equal(view.getShowRowSeparators(), true);
    assert.equal(view.getReorderable(), true);
    assert.equal(column.widget.getTitle(), "Name");
    assert.equal(column.widget.getExpand(), true);
    assert.deepEqual(cellLabels(view), ["0:alpha!", "1:beta!", "2:gamma!"]);

    assert.equal(view.getModel().getSelected(), 0);
    selected.value = 2;
    await nextTick();
    assert.equal(view.getModel().getSelected(), 2, "the prop drives the selection");

    view.getModel().setSelected(1);
    await nextTick();
    assert.equal(selected.value, 1, "native selection updates v-model:selected");

    suffix.value = "?";
    await nextTick();
    pump();
    assert.deepEqual(cellLabels(view), ["0:alpha?", "1:beta?", "2:gamma?"]);

    store.splice(0, 1, [Gtk.StringObject.new("ALPHA")]);
    await nextTick();
    pump();
    assert.deepEqual(cellLabels(view), ["0:ALPHA?", "1:beta?", "2:gamma?"]);

    store.splice(0, store.getNItems(), [
      Gtk.StringObject.new("gamma"),
      Gtk.StringObject.new("beta"),
      Gtk.StringObject.new("ALPHA"),
    ]);
    await nextTick();
    pump();
    assert.deepEqual(
      cellLabels(view),
      ["0:gamma?", "1:beta?", "2:ALPHA?"],
      "a model reorder rebinds the cells without stale widgets",
    );
  } finally {
    app.unmount();
  }
});

await test("VColumnViewColumn factory renders a widget root and releases it on unbind/teardown", async () => {
  const store = stringStore(["alpha"]);
  let column;
  const app = mount(() =>
    h(
      VColumnView,
      { model: store },
      {
        columns: () =>
          h(
            VColumnViewColumn,
            { ref: (value) => (column = value), title: "Name" },
            {
              cell: ({ item }) => h(VLabel, null, { default: () => item?.getString() ?? "empty" }),
            },
          ),
      },
    ),
  );
  try {
    const item = new Gtk.ListItem();
    column.factory.emit("setup", item);
    assert.ok(item.getChild() instanceof Gtk.Box, "the cell host is a normal GTK widget");
    column.factory.emit("bind", item);
    await nextTick();
    const host = item.getChild();
    assert.equal(children(host).length, 1);
    assert.ok(children(host)[0] instanceof Gtk.Label, "the #cell root is a widget");
    column.factory.emit("unbind", item);
    await nextTick();
    assert.equal(children(host).length, 0, "unbind releases the teleported cell");
    column.factory.emit("bind", item);
    await nextTick();
    assert.equal(children(host).length, 1, "rebinding mounts the cell again");
    column.factory.emit("teardown", item);
    assert.equal(item.getChild(), null, "teardown detaches the cell host");
  } finally {
    app.unmount();
  }
});

await test("VColumnView single and multiple selection modes restrict the model correctly", async () => {
  const store = stringStore(["a", "b", "c"]);
  const single = ref(0);
  const singleApp = mount(() =>
    h(VColumnView, {
      model: store,
      selected: single.value,
      "onUpdate:selected": (value) => (single.value = value),
    }),
  );
  try {
    const view = widgetOf(singleApp);
    assert.ok(view.getModel() instanceof Gtk.SingleSelection);
    assert.equal(view.getModel().getNItems(), 3);
    view.getModel().setSelected(2);
    await nextTick();
    assert.equal(single.value, 2);
    assert.equal(view.getModel().getSelected(), 2);
  } finally {
    singleApp.unmount();
  }

  const multiple = ref([0, 2]);
  const multipleApp = mount(() =>
    h(VColumnView, {
      model: store,
      selectionMode: "multiple",
      selected: multiple.value,
      "onUpdate:selected": (value) => (multiple.value = value),
    }),
  );
  try {
    const view = widgetOf(multipleApp);
    assert.ok(view.getModel() instanceof Gtk.MultiSelection);
    assert.equal(Number(view.getModel().getSelection().getSize()), 2);
    view.getModel().selectItem(1, false);
    await nextTick();
    assert.deepEqual(multiple.value, [0, 1, 2], "multiple mode keeps every selected index");

    multiple.value = [1];
    await nextTick();
    assert.equal(Number(view.getModel().getSelection().getSize()), 1);
    assert.equal(view.getModel().getSelection().contains(1), true);
    assert.deepEqual(multiple.value, [1], "a prop update is not clobbered by intermediate signals");
  } finally {
    multipleApp.unmount();
  }
});

await test("collection views clear the model and detach factories without Gtk warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gio from "gi:Gio-2.0";
    import { getGType } from "node-gtk";
    import {
      createApp, h, nextTick, shallowRef, VBox, VColumnView, VColumnViewColumn,
      VGridView, VLabel, VWindow,
    } from "@zede/vio";
    Gtk.init();
    const store = Gio.ListStore.new(getGType(Gtk.StringObject));
    store.append(Gtk.StringObject.new("one"));
    const model = shallowRef(store);
    let view;
    let column;
    let grid;
    const app = createApp({
      render: () => h(VWindow, null, {
        default: () => h(VBox, null, {
          default: () => [
            h(VColumnView, { ref: (value) => (view = value), model: model.value }, {
              columns: () => h(VColumnViewColumn, { ref: (value) => (column = value), title: "Name" }, {
                cell: () => h(VLabel, null, { default: () => "row" }),
              }),
            }),
            h(VGridView, { ref: (value) => (grid = value), model: model.value }, {
              item: () => h(VLabel, null, { default: () => "tile" }),
            }),
          ],
        }),
      }),
    });
    app.mount();
    const viewWidget = view.widget;
    const columnWidget = column.widget;
    const gridWidget = grid.widget;
    model.value = null;
    await nextTick();
    if (viewWidget.getModel() !== null) throw new Error("column view model was not cleared");
    if (gridWidget.getModel() !== null) throw new Error("grid view model was not cleared");
    app.unmount();
    if (columnWidget.getFactory() !== null) throw new Error("column factory leaked on unmount");
    if (gridWidget.getFactory() !== null) throw new Error("grid factory leaked on unmount");
    console.log("views-reset-ok");
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "@zede/vio/register", "--input-type=module", "-e", source],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
      env: process.env,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "views-reset-ok");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});

await test("VGridView renders tiles, binds selection and maps min/max columns", async () => {
  const store = stringStore(["one", "two", "three"]);
  const selected = ref(0);
  let grid;
  const app = mount(() =>
    h(
      VWindow,
      { defaultWidth: 420, defaultHeight: 320 },
      {
        default: () =>
          h(
            VGridView,
            {
              ref: (value) => (grid = value),
              model: store,
              selected: selected.value,
              "onUpdate:selected": (value) => (selected.value = value),
              minColumns: 2,
              maxColumns: 4,
            },
            {
              item: ({ item }) => h(VLabel, null, { default: () => item?.getString() ?? "empty" }),
            },
          ),
      },
    ),
  );
  try {
    const view = (await realize(app)).getChild();
    assert.ok(view instanceof Gtk.GridView);
    assert.equal(view.getMinColumns(), 2);
    assert.equal(view.getMaxColumns(), 4);
    assert.ok(view.getFactory() instanceof Gtk.SignalListItemFactory);
    assert.deepEqual(labelsIn(view).sort(), ["one", "three", "two"]);
    assert.equal(view.getModel().getSelected(), 0);

    selected.value = 2;
    await nextTick();
    assert.equal(view.getModel().getSelected(), 2);
    view.getModel().setSelected(1);
    await nextTick();
    assert.equal(selected.value, 1);

    const item = new Gtk.ListItem();
    grid.factory.emit("setup", item);
    grid.factory.emit("bind", item);
    await nextTick();
    assert.ok(item.getChild() instanceof Gtk.Box);
    assert.equal(children(item.getChild()).length, 1);
    grid.factory.emit("unbind", item);
    await nextTick();
    assert.equal(children(item.getChild()).length, 0);
  } finally {
    app.unmount();
  }
});

await test("VIconView binds a Gtk.TreeModel selection and rejects widget cells", async () => {
  const tree = stringTree(["<b>first</b>", "<b>second</b>"]);
  const model = shallowRef(tree);
  const selected = ref(0);
  const app = mount(() =>
    h(
      VWindow,
      { defaultWidth: 320, defaultHeight: 240 },
      {
        default: () =>
          h(VIconView, {
            model: model.value,
            selected: selected.value,
            selectionMode: "single",
            markupColumn: 0,
            "onUpdate:selected": (value) => (selected.value = value),
          }),
      },
    ),
  );
  try {
    const view = (await realize(app)).getChild();
    assert.ok(view instanceof Gtk.IconView);
    assert.equal(view.getModel(), tree);
    assert.equal(view.getMarkupColumn(), 0);
    assert.equal(view.getSelectionMode(), Gtk.SelectionMode.SINGLE);
    assert.equal(view.getSelectedItems().length, 1, "the selected prop selects the first row");

    view.selectPath(Gtk.TreePath.newFromIndices([1]));
    await nextTick();
    assert.equal(selected.value, 1, "native selection updates v-model:selected");

    selected.value = 0;
    await nextTick();
    assert.equal(view.getSelectedItems().length, 1);
    assert.equal(view.getSelectedItems()[0].getIndices()[0], 0);

    model.value = null;
    await nextTick();
    assert.equal(view.getModel(), null);
  } finally {
    app.unmount();
  }

  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.throws(
      () =>
        mount(() =>
          h(
            VIconView,
            { model: tree },
            {
              item: () => h(VLabel, null, { default: () => "not supported" }),
            },
          ),
        ),
      /vio: 'VIconView' does not support #item/,
    );
  } finally {
    console.warn = warn;
  }
});

await test("VTextView keeps v-model:text in sync in both directions without recursion", async () => {
  const text = ref("hello");
  let updates = 0;
  let view;
  const app = mount(() =>
    h(VTextView, {
      ref: (value) => (view = value),
      text: text.value,
      "onUpdate:text": (value) => {
        updates++;
        text.value = value;
      },
      editable: true,
      monospace: true,
      wrapMode: "word-char",
    }),
  );
  try {
    const widget = widgetOf(app);
    const buffer = widget.getBuffer();
    assert.equal(widget.getEditable(), true);
    assert.equal(widget.getMonospace(), true);
    assert.equal(widget.getWrapMode(), Gtk.WrapMode.WORD_CHAR);
    assert.equal(buffer.getText(buffer.getStartIter(), buffer.getEndIter(), true), "hello");

    text.value = "changed";
    await nextTick();
    assert.equal(buffer.getText(buffer.getStartIter(), buffer.getEndIter(), true), "changed");
    assert.equal(updates, 0, "a programmatic update must not echo back into the model");

    buffer.setText("typed", -1);
    await nextTick();
    assert.equal(text.value, "typed");
    assert.equal(updates, 1);
    assert.equal(view.widget, widget);
  } finally {
    app.unmount();
  }

  const external = new Gtk.TextBuffer();
  const externalText = ref("external");
  const externalApp = mount(() =>
    h(VTextView, {
      buffer: external,
      text: externalText.value,
      "onUpdate:text": (value) => (externalText.value = value),
    }),
  );
  try {
    const widget = widgetOf(externalApp);
    assert.equal(widget.getBuffer(), external);
    assert.equal(
      external.getText(external.getStartIter(), external.getEndIter(), true),
      "external",
    );
    external.setText("natively edited", -1);
    await nextTick();
    assert.equal(externalText.value, "natively edited");
  } finally {
    externalApp.unmount();
  }
});

await test("VEditableLabel preserves the caret for equal text and binds edits", async () => {
  const text = ref("hello");
  const marker = ref("one");
  let updates = 0;
  let label;
  const app = mount(() =>
    h(VEditableLabel, {
      ref: (value) => (label = value),
      text: text.value,
      editable: true,
      class: marker.value,
      "onUpdate:text": (value) => {
        updates++;
        text.value = value;
      },
    }),
  );
  try {
    const widget = widgetOf(app);
    assert.ok(widget instanceof Gtk.EditableLabel);
    assert.equal(widget.getText(), "hello");
    assert.equal(widget.getEditable(), true);

    widget.setPosition(2);
    marker.value = "two";
    await nextTick();
    assert.equal(widget.getPosition(), 2, "an equal text update keeps the caret position");
    assert.equal(updates, 0);

    text.value = "bye";
    await nextTick();
    assert.equal(widget.getText(), "bye");

    widget.setText("typed");
    await nextTick();
    assert.equal(text.value, "typed");
    assert.equal(updates, 1);
    assert.equal(label.widget, widget);
  } finally {
    app.unmount();
  }
});

await test("VSearchEntry binds text, placeholder and emits search without debounce", async () => {
  const text = ref("");
  const searches = [];
  const app = mount(() =>
    h(VSearchEntry, {
      text: text.value,
      placeholderText: "filter",
      "onUpdate:text": (value) => (text.value = value),
      onSearch: (value) => searches.push(value),
    }),
  );
  try {
    const entry = widgetOf(app);
    assert.ok(entry instanceof Gtk.SearchEntry);
    assert.equal(entry.getPlaceholderText(), "filter");

    entry.setText("abc");
    await nextTick();
    assert.equal(text.value, "abc");
    assert.deepEqual(searches, ["abc"], "the immediate changed signal is forwarded as search");

    text.value = "xyz";
    await nextTick();
    assert.equal(entry.getText(), "xyz");
    assert.equal(searches.length, 1, "a programmatic model update does not emit search");

    entry.setText("q");
    await nextTick();
    assert.deepEqual(searches, ["abc", "q"], "search has no timer-based debounce");
  } finally {
    app.unmount();
  }
});

await test("VSearchBar requires a VSearchEntry child and binds search-mode-enabled", async () => {
  assert.throws(
    () =>
      mount(() => h(VSearchBar, null, { default: () => h(VLabel, null, { default: () => "no" }) })),
    /vio: 'VSearchBar' requires a VSearchEntry child/,
  );

  const enabled = ref(false);
  const app = mount(() =>
    h(
      VSearchBar,
      {
        searchModeEnabled: enabled.value,
        showCloseButton: true,
        "onUpdate:searchModeEnabled": (value) => (enabled.value = value),
      },
      { default: () => h(VSearchEntry, { placeholderText: "search" }) },
    ),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.SearchBar);
    assert.ok(bar.getChild() instanceof Gtk.SearchEntry, "connectEntry() got a SearchEntry");
    assert.equal(bar.getShowCloseButton(), true);
    assert.equal(bar.getSearchMode(), false);

    enabled.value = true;
    await nextTick();
    assert.equal(bar.getSearchMode(), true);

    bar.setSearchMode(false);
    await nextTick();
    assert.equal(enabled.value, false);
  } finally {
    app.unmount();
  }
});

await test("VActionBar packs #start and #end in order and keeps wrapper identity on reorder", async () => {
  const start = ref(["a", "b", "c"]);
  const end = ref(["x", "y"]);
  const sections = (bar) => {
    const center = bar.getFirstChild()?.getChild();
    const [startBox, endBox] = children(center);
    return { start: startBox, end: endBox };
  };
  const app = mount(() =>
    h(VActionBar, null, {
      start: () =>
        start.value.map((key) => h(VButton, { key }, { default: () => key.toUpperCase() })),
      end: () => end.value.map((key) => h(VButton, { key }, { default: () => key.toUpperCase() })),
    }),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.ActionBar);
    assert.deepEqual(labelsIn(sections(bar).start), ["A", "B", "C"]);
    assert.deepEqual(labelsIn(sections(bar).end), ["X", "Y"]);
    const wrappers = new Map(
      children(sections(bar).start).map((wrapper) => [labelsIn(wrapper)[0], wrapper]),
    );

    start.value = ["c", "a", "b"];
    end.value = ["y", "x"];
    await nextTick();
    assert.deepEqual(labelsIn(sections(bar).start), ["C", "A", "B"]);
    assert.deepEqual(labelsIn(sections(bar).end), ["Y", "X"]);
    for (const wrapper of children(sections(bar).start))
      assert.equal(wrapper, wrappers.get(labelsIn(wrapper)[0]), "repack keeps wrapper identity");
  } finally {
    app.unmount();
  }
});

await test("VInfoBar uses addChild/addActionWidget and forwards response and close", async () => {
  const content = ref("first");
  const responses = [];
  let closed = false;
  const app = mount(() =>
    h(
      VInfoBar,
      {
        messageType: "warning",
        showCloseButton: true,
        onResponse: (response) => {
          responses.push(response);
        },
        onClose: () => {
          closed = true;
        },
      },
      {
        content: () => h(VLabel, null, { default: () => content.value }),
        action: () => h(VButton, null, { default: () => "Act" }),
      },
    ),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.InfoBar);
    assert.equal(bar.getMessageType(), Gtk.MessageType.WARNING);
    assert.equal(bar.getShowCloseButton(), true);
    assert.equal(
      typeof bar.setChild,
      "undefined",
      "InfoBar has no setChild; content uses addChild",
    );
    assert.deepEqual(labelsIn(bar).sort(), ["Act", "first"]);

    content.value = "second";
    await nextTick();
    assert.ok(labelsIn(bar).includes("second"));

    bar.emit("response", Gtk.ResponseType.OK);
    assert.deepEqual(responses, [Gtk.ResponseType.OK]);
    bar.emit("close");
    assert.equal(closed, true);
  } finally {
    app.unmount();
  }
});

await test("VStatusbar pushes the full message array and clears it", async () => {
  const messages = ref(["one"]);
  let statusbar;
  const app = mount(() =>
    h(VStatusbar, {
      ref: (value) => (statusbar = value),
      messages: messages.value,
    }),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.Statusbar);
    assert.deepEqual(labelsIn(bar), ["one"]);
    assert.equal(statusbar.widget, bar);

    messages.value = ["a", "b"];
    await nextTick();
    assert.deepEqual(labelsIn(bar), ["b"], "remove_all + push leaves the last message");
    assert.equal(labelsIn(bar).length, 1, "old messages are cleared before the sync");

    messages.value = [];
    await nextTick();
    assert.deepEqual(labelsIn(bar).filter(Boolean), []);
  } finally {
    app.unmount();
  }
});

await test("VTreeView stays a thin TreeModel wrapper and createTreeListModel builds a list model", async () => {
  const tree = stringTree(["one", "two"]);
  const model = shallowRef(tree);
  const app = mount(() =>
    h(VTreeView, {
      model: model.value,
      headersVisible: false,
      reorderable: true,
    }),
  );
  try {
    const view = widgetOf(app);
    assert.ok(view instanceof Gtk.TreeView);
    assert.equal(view.getModel(), tree);
    assert.equal(view.getHeadersVisible(), false);
    assert.equal(view.getReorderable(), true);
    model.value = null;
    await nextTick();
    assert.equal(view.getModel(), null);
  } finally {
    app.unmount();
  }

  const store = stringStore(["root", "sibling"]);
  const treeList = createTreeListModel(store);
  assert.ok(treeList instanceof Gtk.TreeListModel);
  assert.equal(treeList.getModel(), store, "the model wraps the flat Gio.ListModel");
  assert.equal(treeList.getNItems(), 2);
  assert.equal(treeList.getRow(0).getItem().getString(), "root");
  assert.equal(treeList.getRow(0).isExpandable(), false);
});

await test("VTreeView declares text, toggle and pixbuf columns on a real ListStore", async () => {
  const store = Gtk.ListStore.new([GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]);
  const iter = store.append();
  const name = new GObject.Value();
  name.init(GObject.TYPE_STRING);
  name.setString("alpha");
  store.setValue(iter, 0, name);
  const active = new GObject.Value();
  active.init(GObject.TYPE_BOOLEAN);
  active.setBoolean(false);
  store.setValue(iter, 1, active);

  const edited = [];
  const toggled = [];
  let text;
  let toggle;
  let pixbuf;
  let tree;
  const app = mount(() =>
    h(
      VTreeView,
      { ref: (value) => (tree = value), model: store, headersVisible: true, reorderable: true },
      {
        columns: () => [
          h(
            VTreeViewColumn,
            { title: "Name", expand: true, resizable: true, sortColumnId: 0 },
            {
              default: () =>
                h(VCellRendererText, {
                  ref: (value) => (text = value),
                  column: 0,
                  editable: true,
                  onEdited: (path, value) => edited.push([path, value]),
                }),
            },
          ),
          h(
            VTreeViewColumn,
            { title: "Active", sortColumnId: 1 },
            {
              default: () =>
                h(VCellRendererToggle, {
                  ref: (value) => (toggle = value),
                  column: 1,
                  onToggled: (path) => toggled.push(path),
                }),
            },
          ),
          h(
            VTreeViewColumn,
            { title: "Icon" },
            {
              default: () =>
                h(VCellRendererPixbuf, { ref: (value) => (pixbuf = value), modelColumn: -1 }),
            },
          ),
        ],
      },
    ),
  );
  try {
    const view = widgetOf(app);
    assert.ok(view instanceof Gtk.TreeView);
    assert.equal(tree.widget, view);
    assert.equal(tree.columns.length, 3);
    const columns = view.getColumns();
    assert.deepEqual(
      columns.map((column) => column.getTitle()),
      ["Name", "Active", "Icon"],
    );
    assert.equal(columns[0].getExpand(), true);
    assert.equal(columns[0].getResizable(), true);
    assert.equal(columns[0].getSortColumnId(), 0);
    assert.equal(columns[1].getSortColumnId(), 1);
    assert.deepEqual(
      columns.map((column) => column.getCells().map((cell) => cell.constructor.name)),
      [["GtkCellRendererText"], ["GtkCellRendererToggle"], ["GtkCellRendererPixbuf"]],
    );
    assert.equal(text.renderer.editable, true);
    assert.equal(toggle.renderer.getActivatable(), true);
    assert.ok(pixbuf.renderer instanceof Gtk.CellRendererPixbuf);
    assert.equal(store.getValue(iter, 0).getString(), "alpha");
    assert.equal(store.getValue(iter, 1).getBoolean(), false);

    // node-gtk 4.1.1 cannot synthesize ::edited/::toggled through GObject.emit (the static-scope
    // string conversion fails), so the wrappers expose the same forwarding function they connect
    // to the native renderer. This exercises the Vue event path without pretending properties are
    // signals; real user edits reach the same function from GTK.
    text.emitEdited("0", "beta");
    toggle.emitToggled("0");
    assert.deepEqual(edited, [["0", "beta"]]);
    assert.deepEqual(toggled, ["0"]);

    name.setString("gamma");
    store.setValue(iter, 0, name);
    assert.equal(store.getValue(iter, 0).getString(), "gamma");
  } finally {
    app.unmount();
  }
});

await test("VInscription maps text-overflow, nat sizes and no widget children", () => {
  const app = mount(() =>
    h(VInscription, {
      text: "inscription",
      natChars: 12,
      natLines: 2,
      textOverflow: "end",
    }),
  );
  try {
    const widget = widgetOf(app);
    assert.ok(widget instanceof Gtk.Inscription);
    assert.equal(widget.getText(), "inscription");
    assert.equal(widget.getNatChars(), 12);
    assert.equal(widget.getNatLines(), 2);
    assert.equal(widget.getTextOverflow(), Gtk.InscriptionOverflow.ELLIPSIZE_END);
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.throws(
        () => mount(() => h(VInscription, { text: "x", textOverflow: "unknown" })),
        /vio: unknown text-overflow 'unknown'/,
      );
      assert.throws(
        () => mount(() => h(VInscription, { text: "x" }, { default: () => h(VLabel) })),
        /vio: 'VInscription' cannot contain children/,
      );
    } finally {
      console.warn = warn;
    }
  } finally {
    app.unmount();
  }
});
