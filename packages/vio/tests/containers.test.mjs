import assert from "node:assert/strict";
import { test } from "node:test";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  createApp,
  createRoot,
  getWidgetDefinition,
  hasWidget,
  h,
  nextTick,
  ref,
  registerWidget,
  shallowRef,
  useDetachedSlot,
  useNative,
  VBox,
  VCenterBox,
  VFixed,
  VFlowBox,
  VHeaderBar,
  VLabel,
  VListModel,
  VListView,
  VNotebook,
  VNotebookPage,
  VOverlay,
  VPaned,
  VWindow,
} from "@zede/vio";

Gtk.init();

const children = (widget) => {
  const result = [];
  for (let child = widget?.getFirstChild(); child; child = child.getNextSibling())
    result.push(child);
  return result;
};
const flowChildren = (flow) => {
  const result = [];
  for (let index = 0; flow.getChildAtIndex(index); index++)
    result.push(flow.getChildAtIndex(index).getChild());
  return result;
};
const labelsIn = (widget) => {
  const result = [];
  const walk = (node) => {
    for (const child of children(node)) {
      if (typeof child.getLabel === "function") {
        const text = child.getLabel();
        if (text != null) result.push(text);
      }
      walk(child);
    }
  };
  walk(widget);
  return result;
};
const mount = (render) => {
  const app = createApp({ render });
  app.mount();
  return app;
};
const windowOf = (app) => app.root.children[0].widget;
const pageMap = (notebook) =>
  new Map(
    Array.from({ length: notebook.getNPages() }, (_, index) => {
      const page = notebook.getNthPage(index);
      const label = notebook.getTabLabel(page);
      return [
        typeof label?.getLabel === "function" ? label.getLabel() : labelsIn(label).join(""),
        page,
      ];
    }),
  );

await test("VNotebook: static pages, tab labels and keyed add/remove/reorder", async () => {
  const items = ref(["a", "b", "c"]);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VNotebook, null, {
          default: () =>
            items.value.map((key) =>
              h(
                VNotebookPage,
                { key, label: key.toUpperCase() },
                { default: () => h(VLabel, null, { default: () => key }) },
              ),
            ),
        }),
    }),
  );
  try {
    const notebook = windowOf(app).getChild();
    assert.equal(notebook.getNPages(), 3);
    assert.deepEqual([...pageMap(notebook).keys()], ["A", "B", "C"]);
    assert.deepEqual(
      [...pageMap(notebook).values()].map((page) => children(page)[0].getLabel()),
      ["a", "b", "c"],
    );
    const before = pageMap(notebook);

    items.value = ["c", "a"];
    await nextTick();
    assert.deepEqual([...pageMap(notebook).keys()], ["C", "A"]);
    assert.equal(pageMap(notebook).get("A"), before.get("A"), "a keyed page keeps its GTK widget");
    assert.equal(pageMap(notebook).get("C"), before.get("C"));

    items.value = ["a", "d"];
    await nextTick();
    assert.deepEqual([...pageMap(notebook).keys()], ["A", "D"]);
    assert.equal(pageMap(notebook).get("A"), before.get("A"));
    assert.equal(before.get("C").getParent(), null, "the removed page is detached");
  } finally {
    app.unmount();
  }
  assert.equal(app.root.children.length, 0);
});

await test("VNotebookPage: label updates and a declarative #tab-label slot", async () => {
  const label = ref("first");
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VNotebook, null, {
          default: () => [
            h(
              VNotebookPage,
              { key: "dynamic", label: label.value },
              { default: () => h(VLabel, null, { default: () => "body" }) },
            ),
            h(
              VNotebookPage,
              { key: "slot" },
              {
                default: () => h(VLabel, null, { default: () => "body-two" }),
                "tab-label": () => h(VLabel, null, { default: () => "SLOT" }),
              },
            ),
          ],
        }),
    }),
  );
  try {
    const notebook = windowOf(app).getChild();
    assert.deepEqual([...pageMap(notebook).keys()], ["first", "SLOT"]);
    const slotLabel = notebook.getTabLabel(pageMap(notebook).get("SLOT"));
    assert.deepEqual(labelsIn(slotLabel), ["SLOT"]);

    label.value = "renamed";
    await nextTick();
    assert.deepEqual([...pageMap(notebook).keys()], ["renamed", "SLOT"]);
  } finally {
    app.unmount();
  }
});

await test("VPaned: both slots, and removing one slot clears it", async () => {
  const showEnd = ref(true);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VPaned, null, {
          start: () => h(VLabel, null, { default: () => "start" }),
          end: showEnd.value ? () => h(VLabel, null, { default: () => "end" }) : undefined,
        }),
    }),
  );
  try {
    const paned = windowOf(app).getChild();
    assert.deepEqual(labelsIn(paned.getStartChild()), ["start"]);
    assert.deepEqual(labelsIn(paned.getEndChild()), ["end"]);
    showEnd.value = false;
    await nextTick();
    assert.equal(paned.getEndChild(), null);
    assert.deepEqual(labelsIn(paned.getStartChild()), ["start"]);
  } finally {
    app.unmount();
  }
});

await test("VOverlay: main child plus an overlay layer", async () => {
  const showOverlay = ref(true);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VOverlay, null, {
          default: () => h(VLabel, null, { default: () => "main" }),
          overlay: showOverlay.value ? () => h(VLabel, null, { default: () => "over" }) : undefined,
        }),
    }),
  );
  try {
    const overlay = windowOf(app).getChild();
    assert.deepEqual(labelsIn(overlay.getChild()), ["main"]);
    assert.equal(children(overlay).length, 2, "main child plus one overlay");
    assert.deepEqual(labelsIn(children(overlay)[1]), ["over"]);
    showOverlay.value = false;
    await nextTick();
    assert.equal(children(overlay).length, 1);
    assert.deepEqual(labelsIn(overlay.getChild()), ["main"]);
  } finally {
    app.unmount();
  }
});

await test("VCenterBox: start, center and end slots", async () => {
  const showStart = ref(true);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VCenterBox, null, {
          start: showStart.value ? () => h(VLabel, null, { default: () => "cs" }) : undefined,
          center: () => h(VLabel, null, { default: () => "cc" }),
          end: () => h(VLabel, null, { default: () => "ce" }),
        }),
    }),
  );
  try {
    const box = windowOf(app).getChild();
    assert.deepEqual(labelsIn(box.getStartWidget()), ["cs"]);
    assert.deepEqual(labelsIn(box.getCenterWidget()), ["cc"]);
    assert.deepEqual(labelsIn(box.getEndWidget()), ["ce"]);
    showStart.value = false;
    await nextTick();
    assert.equal(box.getStartWidget(), null);
    assert.deepEqual(labelsIn(box.getCenterWidget()), ["cc"]);
  } finally {
    app.unmount();
  }
});

await test("VHeaderBar: start/end/title slots and window titlebar role", async () => {
  const showTitlebar = ref(true);
  const app = mount(() =>
    h(VWindow, null, {
      default: () => [
        showTitlebar.value
          ? h(
              VHeaderBar,
              { key: "bar", role: "titlebar" },
              {
                start: () => h(VLabel, null, { default: () => "S" }),
                title: () => h(VLabel, null, { default: () => "T" }),
                end: () => h(VLabel, null, { default: () => "E" }),
              },
            )
          : null,
        h(VLabel, { key: "content" }, { default: () => "content" }),
      ],
    }),
  );
  try {
    const window = windowOf(app);
    const bar = window.getTitlebar();
    assert.ok(bar instanceof Gtk.HeaderBar, "role=titlebar reaches setTitlebar()");
    assert.deepEqual(labelsIn(bar.getTitleWidget()), ["T"]);
    assert.deepEqual(labelsIn(bar).sort(), ["E", "S", "T"]);
    assert.equal(window.getChild().getLabel(), "content");

    showTitlebar.value = false;
    await nextTick();
    assert.equal(window.getTitlebar(), null);
    assert.equal(window.getChild().getLabel(), "content");
  } finally {
    app.unmount();
  }
});

await test("VFlowBox: keyed reorder keeps content widgets; removal detaches them", async () => {
  const items = ref(["a", "b", "c"]);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VFlowBox, null, {
          default: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
        }),
    }),
  );
  try {
    const flow = windowOf(app).getChild();
    assert.deepEqual(
      flowChildren(flow).map((widget) => widget.getLabel()),
      ["a", "b", "c"],
    );
    const before = new Map(flowChildren(flow).map((widget) => [widget.getLabel(), widget]));

    items.value = ["c", "a", "d"];
    await nextTick();
    assert.deepEqual(
      flowChildren(flow).map((widget) => widget.getLabel()),
      ["c", "a", "d"],
    );
    assert.equal(flowChildren(flow)[1], before.get("a"));
    assert.equal(flowChildren(flow)[0], before.get("c"));
    assert.equal(flowChildren(flow)[0].getParent()?.getParent(), flow);

    items.value = ["a"];
    await nextTick();
    assert.deepEqual(
      flowChildren(flow).map((widget) => widget.getLabel()),
      ["a"],
    );
    assert.equal(before.get("c").getParent(), null);
  } finally {
    app.unmount();
  }
});

await test("VFixed: x/y placement and reactive moves", async () => {
  const position = ref([10, 20]);
  const show = ref(true);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VFixed, null, {
          default: () =>
            show.value
              ? h(
                  VLabel,
                  { key: "item", x: position.value[0], y: position.value[1] },
                  {
                    default: () => "fixed",
                  },
                )
              : null,
        }),
    }),
  );
  try {
    const fixed = windowOf(app).getChild();
    fixed.allocate(200, 200, -1, null);
    assert.deepEqual(fixed.getChildPosition(fixed.getFirstChild()), [10, 20]);

    position.value = [40, 60];
    await nextTick();
    fixed.allocate(200, 200, -1, null);
    assert.deepEqual(fixed.getChildPosition(fixed.getFirstChild()), [40, 60]);
    assert.equal(children(fixed).length, 1, "move does not duplicate the child");

    show.value = false;
    await nextTick();
    assert.equal(children(fixed).length, 0);
  } finally {
    app.unmount();
  }
});

await test("unmount detaches role children instead of leaking them", async () => {
  const root = createRoot(new Gtk.Box());
  const app = createApp({
    setup: () => () =>
      h(VNotebook, null, {
        default: () =>
          h(
            VNotebookPage,
            { label: "one" },
            { default: () => h(VLabel, null, { default: () => "x" }) },
          ),
      }),
  });
  app.mount(root);
  const notebook = children(root.widget)[0];
  assert.equal(notebook.getNPages(), 1);
  app.unmount();
  assert.equal(root.children.length, 0);
  assert.equal(children(root.widget).length, 0);
  assert.equal(notebook.getParent(), null, "the whole notebook subtree is detached");
});

await test("registerWidget insertChild/removeChild drives a Notebook without wrappers", async () => {
  registerWidget("test-placement-notebook", {
    create: () => new Gtk.Notebook(),
    children: "none",
    insertChild({ parentWidget, child, node, role, index }) {
      assert.equal(role, "page");
      if (parentWidget.pageNum(child) === -1)
        parentWidget.appendPage(
          child,
          new Gtk.Label({ label: String(node.props["tab-label"] ?? "") }),
        );
      const position = Math.max(0, Math.min(index, parentWidget.getNPages() - 1));
      if (parentWidget.pageNum(child) !== position) parentWidget.reorderChild(child, position);
    },
    removeChild({ parentWidget, child, role }) {
      if (role !== "page") return;
      const page = parentWidget.pageNum(child);
      if (page !== -1) parentWidget.removePage(page);
    },
  });
  assert.equal(hasWidget("test-placement-notebook"), true);
  const definition = getWidgetDefinition("test-placement-notebook");
  assert.equal(typeof definition.insertChild, "function");

  const items = ref(["a", "b"]);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(
          "test-placement-notebook",
          null,
          items.value.map((key) => h("label", { key, role: "page", "tab-label": key }, key)),
        ),
    }),
  );
  try {
    const notebook = windowOf(app).getChild();
    assert.deepEqual([...pageMap(notebook).keys()], ["a", "b"]);
    const before = pageMap(notebook);

    items.value = ["b", "a", "c"];
    await nextTick();
    assert.deepEqual([...pageMap(notebook).keys()], ["b", "a", "c"]);
    assert.equal(pageMap(notebook).get("a"), before.get("a"));

    const page = notebook.getNthPage(0);
    definition.removeChild({
      parentWidget: notebook,
      child: page,
      role: "page",
      node: null,
      parent: null,
      before: null,
      index: 0,
    });
    definition.removeChild({
      parentWidget: notebook,
      child: page,
      role: "page",
      node: null,
      parent: null,
      before: null,
      index: 0,
    });
    assert.equal(notebook.getNPages(), 2, "remove is idempotent");
  } finally {
    app.unmount();
  }
});

await test("createRoot resolves a mode for Notebook, Paned and FlowBox widgets", async () => {
  const notebookRoot = createRoot(new Gtk.Notebook());
  const notebookApp = createApp({
    setup: () => () =>
      h(
        VNotebookPage,
        { label: "page" },
        { default: () => h(VLabel, null, { default: () => "body" }) },
      ),
  });
  notebookApp.mount(notebookRoot);
  assert.equal(notebookRoot.widget.getNPages(), 1);
  assert.equal(
    notebookRoot.widget.getTabLabel(notebookRoot.widget.getNthPage(0)).getLabel(),
    "page",
  );
  notebookApp.unmount();

  const panedRoot = createRoot(new Gtk.Paned(), "vio-paned");
  const panedApp = createApp({
    setup: () => () => [
      h("box", { role: "start" }, [h(VLabel, null, { default: () => "s" })]),
      h("box", { role: "end" }, [h(VLabel, null, { default: () => "e" })]),
    ],
  });
  panedApp.mount(panedRoot);
  assert.deepEqual(labelsIn(panedRoot.widget.getStartChild()), ["s"]);
  assert.deepEqual(labelsIn(panedRoot.widget.getEndChild()), ["e"]);
  panedApp.unmount();

  const flowRoot = createRoot(new Gtk.FlowBox());
  const flowApp = createApp({
    setup: () => () => [
      h(VLabel, null, { default: () => "f1" }),
      h(VLabel, null, { default: () => "f2" }),
    ],
  });
  flowApp.mount(flowRoot);
  assert.deepEqual(
    flowChildren(flowRoot.widget).map((widget) => widget.getLabel()),
    ["f1", "f2"],
  );
  flowApp.unmount();
});

await test("invalid children modes and duplicate registrations are rejected", () => {
  assert.throws(
    () => registerWidget("test-invalid-mode", { create: () => new Gtk.Box(), children: "roles" }),
    /unknown children mode 'roles'/,
  );
  assert.equal(hasWidget("test-invalid-mode"), false);
  registerWidget("test-invalid-mode", { create: () => new Gtk.Box(), children: "none" });
  assert.throws(
    () => registerWidget("test-invalid-mode", { create: () => new Gtk.Box(), children: "none" }),
    /already registered/,
  );
});

await test("object properties: shallowRef updates and dedicated null setters", async () => {
  registerWidget("test-picture", { create: () => new Gtk.Picture() });
  registerWidget("test-popover-menu", { create: () => new Gtk.PopoverMenu(), children: "none" });

  const storeA = Gio.ListStore.new(getGType(Gtk.StringObject));
  storeA.append(Gtk.StringObject.new("a"));
  const storeB = Gio.ListStore.new(getGType(Gtk.StringObject));
  storeB.append(Gtk.StringObject.new("b"));
  const selectionA = new Gtk.SingleSelection({ model: storeA });
  const selectionB = new Gtk.SingleSelection({ model: storeB });
  const factoryA = new Gtk.SignalListItemFactory();
  const file = shallowRef(Gio.File.newForPath("/tmp/vio-test.png"));
  const menu = shallowRef(Gio.Menu.new());
  const model = useNative(selectionA);
  const factory = useNative(factoryA);
  assert.equal(model.value, selectionA, "useNative keeps the GObject identity");

  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VBox, null, {
          default: () => [
            h(VListView, { key: "view", model: model.value, factory: factory.value }),
            h("test-picture", { key: "picture", file: file.value }),
            h("test-popover-menu", { key: "menu", menuModel: menu.value }),
          ],
        }),
    }),
  );
  try {
    const box = windowOf(app).getChild();
    const [view, picture, popover] = children(box);
    assert.equal(view.getModel(), selectionA);
    assert.equal(view.getFactory(), factoryA);
    assert.ok(picture.getFile() !== null);
    assert.equal(popover.getMenuModel(), menu.value);

    model.value = selectionB;
    await nextTick();
    assert.equal(view.getModel(), selectionB);

    model.value = null;
    factory.value = null;
    file.value = null;
    menu.value = null;
    await nextTick();
    assert.equal(view.getModel(), null, "setModel(null) clears instead of throwing");
    assert.equal(view.getFactory(), null);
    assert.equal(picture.getFile(), null);
    assert.equal(popover.getMenuModel(), null);
  } finally {
    app.unmount();
  }
});

await test("VListModel: declarative store, factory callbacks, add/remove and unmount", async () => {
  const items = ref(["one", "two"]);
  let handle;
  const app = createApp({
    setup: () => () =>
      h(VListModel, {
        ref: (value) => {
          handle = value;
        },
        items: items.value,
        selected: 1,
      }),
  });
  const root = createRoot(new Gtk.Box());
  app.mount(root);
  try {
    assert.ok(handle, "component ref exposes the model handle");
    assert.equal(handle.store.getNItems(), 2);
    assert.equal(handle.selection.getSelected(), 1);
    assert.deepEqual(
      [0, 1].map((index) => handle.store.getItem(index).getString()),
      ["one", "two"],
    );

    let setups = 0;
    let binds = 0;
    handle.factory.on("setup", () => setups++);
    handle.factory.on("bind", () => binds++);
    const view = new Gtk.ListView({ model: handle.selection, factory: handle.factory });
    const host = new Gtk.Window();
    host.setChild(view);
    view.allocate(300, 300, -1, null);
    assert.ok(setups > 0, "SignalListItemFactory setup ran from JS");
    assert.ok(binds > 0, "SignalListItemFactory bind ran from JS");

    items.value = ["two", "four"];
    await nextTick();
    assert.deepEqual(
      [0, 1].map((index) => handle.store.getItem(index).getString()),
      ["two", "four"],
    );

    items.value = [];
    await nextTick();
    assert.equal(handle.store.getNItems(), 0);
  } finally {
    app.unmount();
  }
  assert.equal(root.children.length, 0);
});

await test("useDetachedSlot renders into a widget outside the parent child list", async () => {
  let slot;
  const app = createApp({
    setup: () => {
      slot = useDetachedSlot();
      return () =>
        h(VBox, null, {
          default: () => slot.render(() => h(VLabel, null, { default: () => "detached" })),
        });
    },
  });
  const root = createRoot(new Gtk.Box());
  app.mount(root);
  try {
    assert.equal(children(root.widget).length, 1, "only the host box is in the parent");
    assert.deepEqual(labelsIn(slot.widget), ["detached"]);
  } finally {
    app.unmount();
  }
  assert.equal(children(slot.widget).length, 0, "teleported content is removed on unmount");
});
