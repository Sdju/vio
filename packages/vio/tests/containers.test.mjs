import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import GLib from "gi:GLib-2.0";
import { getGType } from "node-gtk";
import {
  KeepAlive,
  Teleport,
  createApp,
  createRoot,
  defineComponent,
  getRootNames,
  getWidgetDefinition,
  getWidgetTypes,
  hasWidget,
  h,
  nextTick,
  ref,
  registerRoot,
  registerWidget,
  shallowRef,
  unregisterRoot,
  useDetachedSlot,
  useNative,
  VBox,
  VButton,
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
const flowWrappers = (flow) => {
  const result = [];
  for (let index = 0; flow.getChildAtIndex(index); index++)
    result.push(flow.getChildAtIndex(index));
  return result;
};
const flowChildren = (flow) => flowWrappers(flow).map((wrapper) => wrapper.getChild());
const headerSections = (bar) => {
  const center = bar.getFirstChild()?.getChild();
  return {
    start: center?.getStartWidget(),
    center: center?.getCenterWidget(),
    end: center?.getEndWidget(),
  };
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

await test("VOverlay: multiple ordered overlay layers survive moves and removals", async () => {
  const overlayItems = ref(["o1", "o2"]);
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VOverlay, null, {
          default: () => h(VLabel, null, { default: () => "main" }),
          overlay: () =>
            overlayItems.value.map((key) => h(VLabel, { key }, { default: () => key })),
        }),
    }),
  );
  try {
    const overlay = windowOf(app).getChild();
    const layerLabels = () =>
      children(overlay)
        .slice(1)
        .map((layer) => labelsIn(layer));
    const layerWidgets = () =>
      children(overlay)
        .slice(1)
        .map((layer) => layer.getFirstChild());
    assert.deepEqual(labelsIn(overlay.getChild()), ["main"]);
    assert.deepEqual(layerLabels(), [["o1"], ["o2"]], "each overlay child is its own layer");
    const [o1, o2] = layerWidgets();

    overlayItems.value = ["o2", "o1"];
    await nextTick();
    assert.deepEqual(layerLabels(), [["o2"], ["o1"]], "layer order follows the VNode order");
    assert.equal(layerWidgets()[1], o1, "move keeps the overlay widget");
    assert.equal(layerWidgets()[0], o2);

    overlayItems.value = ["o1"];
    await nextTick();
    assert.deepEqual(layerLabels(), [["o1"]], "removing the first layer preserves z-order");
    assert.deepEqual(labelsIn(overlay.getChild()), ["main"], "getChild() is still the main child");
    assert.equal(o2.getParent(), null, "the removed overlay widget is detached");

    overlayItems.value = ["o3", "o1"];
    await nextTick();
    assert.deepEqual(layerLabels(), [["o3"], ["o1"]], "a new first layer goes below the old one");
    assert.equal(layerWidgets()[1], o1);

    overlayItems.value = [];
    await nextTick();
    assert.equal(children(overlay).length, 1);
    assert.equal(o1.getParent(), null);
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

await test("VWindow: visible titlebar is installed before realization and cleared on unmount", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import { createApp, h, VBox, VHeaderBar, VLabel, VWindow } from "@zede/vio";
    Gtk.init();
    const calls = [];
    const original = Gtk.Window.prototype.setTitlebar;
    Gtk.Window.prototype.setTitlebar = function (titlebar) {
      calls.push(this.getRealized());
      return original.call(this, titlebar);
    };
    const windows = (titlebarFirst) => () =>
      h(VWindow, { visible: true }, {
        default: () => [
          titlebarFirst
            ? h(VHeaderBar, { key: "bar", role: "titlebar" }, {
                default: () => h(VLabel, null, { default: () => "bar" }),
              })
            : h(VBox, { key: "body" }, { default: () => h(VLabel, null, { default: () => "body" }) }),
          titlebarFirst
            ? h(VBox, { key: "body" }, { default: () => h(VLabel, null, { default: () => "body" }) })
            : h(VHeaderBar, { key: "bar", role: "titlebar" }, {
                default: () => h(VLabel, null, { default: () => "bar" }),
              }),
        ],
      });
    for (const titlebarFirst of [true, false]) {
      const app = createApp({ render: windows(titlebarFirst) });
      app.mount();
      const window = app.root.children[0].widget;
      if (!(window.getTitlebar() instanceof Gtk.HeaderBar)) throw new Error("titlebar is missing");
      if (!window.getVisible()) throw new Error("the window is not visible after mount");
      if (!window.getChild()) throw new Error("window content is missing");
      app.unmount();
    }
    if (calls.some(Boolean))
      throw new Error("setTitlebar() ran on a realized window: " + JSON.stringify(calls));
    console.log("titlebar-ok");
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
  assert.equal(result.stdout.trim(), "titlebar-ok");
  assert.doesNotMatch(
    result.stderr,
    /gtk_window_set_titlebar\(\) called on a realized window/,
    "mounting and unmounting a visible window must not trigger the GTK titlebar warning",
  );
});

await test("VHeaderBar: keyed move in #start/#end follows the VNode order and keeps identity", async () => {
  const startItems = ref(["a", "b", "c"]);
  const endItems = ref(["x", "y"]);
  const headerButtons = (bar, section) =>
    children(headerSections(bar)[section])
      .filter((widget) => widget instanceof Gtk.Box && labelsIn(widget).length > 0)
      .map((wrapper) => wrapper.getFirstChild());
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(
          VHeaderBar,
          { role: "titlebar" },
          {
            start: () =>
              startItems.value.map((key) =>
                h(VButton, { key }, { default: () => key.toUpperCase() }),
              ),
            title: () => h(VLabel, null, { default: () => "title" }),
            end: () =>
              endItems.value.map((key) =>
                h(VButton, { key }, { default: () => key.toUpperCase() }),
              ),
          },
        ),
    }),
  );
  try {
    const bar = windowOf(app).getTitlebar();
    const startLabels = () => labelsIn(headerSections(bar).start);
    const endLabels = () => labelsIn(headerSections(bar).end);
    const buttons = new Map();
    const wrappers = new Map();
    for (const button of [...headerButtons(bar, "start"), ...headerButtons(bar, "end")]) {
      const key = labelsIn(button)[0].toLowerCase();
      buttons.set(key, button);
      wrappers.set(key, button.getParent());
    }
    assert.deepEqual(startLabels(), ["A", "B", "C"]);
    assert.deepEqual(endLabels(), ["X", "Y"]);

    startItems.value = ["c", "a", "b"];
    endItems.value = ["y", "x"];
    await nextTick();
    assert.deepEqual(startLabels(), ["C", "A", "B"], "#start is packed in VNode order");
    assert.deepEqual(endLabels(), ["Y", "X"], "#end is packed in VNode order (not reversed)");
    for (const key of ["a", "b", "c", "x", "y"]) {
      assert.equal(buttons.get(key).getParent(), wrappers.get(key), `wrapper for ${key} survived`);
    }

    startItems.value = ["b", "c"];
    await nextTick();
    assert.deepEqual(startLabels(), ["B", "C"]);
    assert.equal(buttons.get("a").getParent(), null, "the removed button is detached");
  } finally {
    app.unmount();
  }
});

await test("VHeaderBar: keyed move inserts in the internal box without repacking neighbours", async () => {
  const pump = (iterations = 200) => {
    for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
  };
  const items = ref(["a", "b", "c", "d"]);
  const app = mount(() =>
    h(
      VWindow,
      { visible: true, title: "header move" },
      {
        default: () =>
          h(
            VHeaderBar,
            { role: "titlebar" },
            {
              start: () =>
                items.value.map((key) => h(VButton, { key }, { default: () => key.toUpperCase() })),
              title: () => h(VLabel, null, { default: () => "title" }),
            },
          ),
      },
    ),
  );
  try {
    const window = windowOf(app);
    const bar = window.getTitlebar();
    const startBox = headerSections(bar).start;
    window.present();
    pump();

    const wrappers = new Map();
    const buttons = new Map();
    for (const wrapper of children(startBox)) {
      if (!(wrapper instanceof Gtk.Box)) continue;
      const key = labelsIn(wrapper)[0]?.toLowerCase();
      if (!key) continue;
      wrappers.set(key, wrapper);
      buttons.set(key, wrapper.getFirstChild());
    }
    assert.deepEqual([...wrappers.keys()], ["a", "b", "c", "d"]);

    // A sibling and the moved child are watched separately: reordering inside the same GtkBox
    // must not detach either of them from the window root.
    const rootNotifications = new Map([...wrappers.keys()].map((key) => [key, 0]));
    const buttonRootNotifications = new Map([...buttons.keys()].map((key) => [key, 0]));
    for (const [key, wrapper] of wrappers)
      wrapper.on("notify::root", () => rootNotifications.set(key, rootNotifications.get(key) + 1));
    for (const [key, button] of buttons)
      button.on("notify::root", () =>
        buttonRootNotifications.set(key, buttonRootNotifications.get(key) + 1),
      );

    window.setFocus(buttons.get("a"));
    pump();
    assert.equal(window.getFocus(), buttons.get("a"), "focus starts on the moved button");

    const order = () => labelsIn(startBox);
    items.value = ["b", "c", "d", "a"];
    await nextTick();
    pump();
    assert.deepEqual(order(), ["B", "C", "D", "A"], "the first item moved to the end");
    for (const key of ["a", "b", "c", "d"]) {
      assert.equal(buttons.get(key).getParent(), wrappers.get(key), `${key}: wrapper survived`);
      assert.equal(rootNotifications.get(key), 0, `${key}: wrapper was not unparented`);
      assert.equal(buttonRootNotifications.get(key), 0, `${key}: button was not unparented`);
    }
    assert.equal(window.getFocus(), buttons.get("a"), "focus survives the move to the end");

    items.value = ["a", "b", "c", "d"];
    await nextTick();
    pump();
    assert.deepEqual(order(), ["A", "B", "C", "D"], "the item moved back to the front");
    for (const key of ["a", "b", "c", "d"]) {
      assert.equal(
        buttons.get(key).getParent(),
        wrappers.get(key),
        `${key}: wrapper survived again`,
      );
      assert.equal(rootNotifications.get(key), 0, `${key}: no unparent on the way back`);
      assert.equal(buttonRootNotifications.get(key), 0, `${key}: no unparent on the way back`);
    }
    assert.equal(window.getFocus(), buttons.get("a"), "focus survives the move back to the front");
  } finally {
    app.unmount();
  }
});

await test("VFlowBox: keyed reorder keeps content widgets and FlowBoxChild wrappers", async () => {
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
    const wrappersBefore = new Map(
      flowWrappers(flow).map((wrapper) => [wrapper.getChild().getLabel(), wrapper]),
    );
    for (const [label, wrapper] of wrappersBefore) {
      wrapper.addCssClass(`wrap-${label}`);
      wrapper.getChild().addCssClass(`content-${label}`);
    }

    items.value = ["c", "a", "d"];
    await nextTick();
    assert.deepEqual(
      flowChildren(flow).map((widget) => widget.getLabel()),
      ["c", "a", "d"],
    );
    assert.equal(flowChildren(flow)[1], before.get("a"));
    assert.equal(flowChildren(flow)[0], before.get("c"));
    assert.equal(flowChildren(flow)[0].getParent()?.getParent(), flow);
    assert.equal(flowWrappers(flow)[1], wrappersBefore.get("a"), "FlowBoxChild identity survives");
    assert.equal(flowWrappers(flow)[0], wrappersBefore.get("c"));
    assert.ok(flowWrappers(flow)[1].getCssClasses().includes("wrap-a"), "wrapper classes survive");
    assert.ok(
      flowChildren(flow)[1].getCssClasses().includes("content-a"),
      "content classes survive",
    );
    assert.ok(flowWrappers(flow)[0].getCssClasses().includes("wrap-c"));

    items.value = ["a"];
    await nextTick();
    assert.deepEqual(
      flowChildren(flow).map((widget) => widget.getLabel()),
      ["a"],
    );
    assert.equal(before.get("c").getParent(), null);
    assert.equal(wrappersBefore.get("c").getParent(), null);
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

const lifecycleScenarios = [
  {
    name: "Notebook",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VNotebook, null, {
        default: () =>
          items.value.map((key) =>
            h(
              VNotebookPage,
              { key, label: key },
              {
                default: () => h(VLabel, { key: `label-${key}` }, { default: () => key }),
              },
            ),
          ),
      }),
    widgets: (notebook) => [...pageMap(notebook).values()].map((page) => page.getFirstChild()),
  },
  {
    name: "Paned",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VPaned, null, {
        start: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
        end: () => h(VLabel, null, { default: () => "end" }),
      }),
    widgets: (paned) => children(paned.getStartChild()),
  },
  {
    name: "Overlay",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VOverlay, null, {
        default: () => h(VLabel, null, { default: () => "main" }),
        overlay: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
      }),
    widgets: (overlay) =>
      children(overlay)
        .slice(1)
        .map((layer) => layer.getFirstChild()),
  },
  {
    name: "CenterBox",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VCenterBox, null, {
        start: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
        center: () => h(VLabel, null, { default: () => "center" }),
        end: () => h(VLabel, null, { default: () => "end" }),
      }),
    widgets: (box) => children(box.getStartWidget()),
  },
  {
    name: "HeaderBar",
    container: (app) => windowOf(app).getTitlebar(),
    render: (items) =>
      h(
        VHeaderBar,
        { role: "titlebar" },
        {
          start: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
          title: () => h(VLabel, null, { default: () => "title" }),
        },
      ),
    widgets: (bar) =>
      children(headerSections(bar).start)
        .filter(
          (widget) => widget instanceof Gtk.Box && widget.getFirstChild()?.getLabel?.() != null,
        )
        .map((wrapper) => wrapper.getFirstChild()),
  },
  {
    name: "FlowBox",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VFlowBox, null, {
        default: () => items.value.map((key) => h(VLabel, { key }, { default: () => key })),
      }),
    widgets: (flow) => flowChildren(flow),
  },
  {
    name: "Fixed",
    container: (app) => windowOf(app).getChild(),
    render: (items) =>
      h(VFixed, null, {
        default: () =>
          items.value.map((key, index) =>
            h(VLabel, { key, x: index * 10, y: 0 }, { default: () => key }),
          ),
      }),
    prepare: (fixed) => fixed.allocate(200, 200, -1, null),
    widgets: (fixed) =>
      children(fixed).sort((a, b) => fixed.getChildPosition(a)[0] - fixed.getChildPosition(b)[0]),
  },
];

await test("keyed slot move/remove/unmount detaches widgets in all role containers", async () => {
  for (const scenario of lifecycleScenarios) {
    const items = ref(["a", "b", "c"]);
    const app = mount(() => h(VWindow, null, { default: () => scenario.render(items) }));
    let container;
    try {
      container = scenario.container(app);
      scenario.prepare?.(container);
      const initial = scenario.widgets(container);
      assert.deepEqual(
        initial.map((widget) => widget.getLabel()),
        ["a", "b", "c"],
        `${scenario.name}: initial`,
      );
      const identity = new Map(initial.map((widget) => [widget.getLabel(), widget]));

      items.value = ["c", "a", "b"];
      await nextTick();
      scenario.prepare?.(container);
      const moved = scenario.widgets(container);
      assert.deepEqual(
        moved.map((widget) => widget.getLabel()),
        ["c", "a", "b"],
        `${scenario.name}: move order`,
      );
      for (const widget of moved)
        assert.equal(
          widget,
          identity.get(widget.getLabel()),
          `${scenario.name}: move keeps identity`,
        );

      items.value = ["a", "b"];
      await nextTick();
      scenario.prepare?.(container);
      const remaining = scenario.widgets(container);
      assert.deepEqual(
        remaining.map((widget) => widget.getLabel()),
        ["a", "b"],
        `${scenario.name}: removal order`,
      );
      assert.equal(
        identity.get("c").getParent(),
        null,
        `${scenario.name}: removed widget detached`,
      );
    } finally {
      app.unmount();
    }
    assert.equal(app.root.children.length, 0, `${scenario.name}: root is empty`);
    assert.equal(container.getParent(), null, `${scenario.name}: container is detached`);
  }
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

await test("string Teleport targets resolve through the named-root registry", async () => {
  const target = createRoot(new Gtk.Box());
  const cleanup = registerRoot("vio-teleport-target", target);
  assert.ok(getRootNames().includes("vio-teleport-target"));
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VBox, null, {
          default: () =>
            h(Teleport, { to: "#vio-teleport-target" }, [
              h(VLabel, { key: "teleport" }, { default: () => "teleported" }),
            ]),
        }),
    }),
  );
  try {
    assert.deepEqual(labelsIn(target.widget), ["teleported"]);
  } finally {
    app.unmount();
    cleanup();
  }
  assert.equal(target.children.length, 0, "Teleport anchors are removed on unmount");
  assert.equal(unregisterRoot("vio-teleport-target"), false);
  assert.equal(getRootNames().includes("vio-teleport-target"), false);
});

await test("KeepAlive uses the built-in storage container instead of a user 'div' widget", async () => {
  const show = ref(true);
  const keep = (label) =>
    defineComponent({
      name: `Kept${label}`,
      setup: () => () => h(VLabel, null, { default: () => label }),
    });
  const A = keep("A");
  const B = keep("B");
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(KeepAlive, null, {
          default: () => (show.value ? h(A, { key: "a" }) : h(B, { key: "b" })),
        }),
    }),
  );
  try {
    const window = windowOf(app);
    const a = window.getChild();
    assert.equal(a.getLabel(), "A");
    show.value = false;
    await nextTick();
    assert.equal(window.getChild().getLabel(), "B");
    assert.ok(a.getParent(), "the cached widget is kept in the storage container");
    assert.notEqual(a.getParent(), window, "the cached widget left the window");
    show.value = true;
    await nextTick();
    assert.equal(window.getChild(), a, "reactivation reuses the cached widget");
  } finally {
    app.unmount();
  }
});

await test("getWidgetTypes lists registered types for diagnostics", () => {
  const types = getWidgetTypes();
  for (const type of [
    "window",
    "box",
    "vio-notebook",
    "vio-paned",
    "vio-overlay",
    "vio-center-box",
    "vio-header-bar",
    "vio-flow-box",
    "vio-fixed",
  ])
    assert.ok(types.includes(type), `${type} is listed`);
  assert.equal(hasWidget("div"), false, "KeepAlive storage is internal, not a public registration");
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
