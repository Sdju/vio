import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  VComboBoxText,
  VDropDown,
  VExpander,
  VLabel,
  VLevelBar,
  VLinkButton,
  VMenuButton,
  VPasswordEntry,
  VPopoverMenu,
  VProgressBar,
  VScale,
  VSpinButton,
  VStackSidebar,
  VStackSwitcher,
  VToggleButton,
  createApp,
  createRoot,
  h,
  nextTick,
  ref,
  resolveIntrospected,
  shallowRef,
} from "@zede/vio";

Gtk.init();

const children = (widget) => {
  const result = [];
  for (let child = widget?.getFirstChild(); child; child = child.getNextSibling())
    result.push(child);
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
const widgetOf = (app) => app.root.children[0].widget;
const rootOf = (widget) => {
  let node = widget;
  while (node?.getParent()) node = node.getParent();
  return node;
};
const contains = (parent, child) => child.getParent() === parent || rootOf(child) === parent;

const allowlisted = [
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
];

/**
 * These four put `setChild()` content into an internal container (`GtkGizmo` for MenuButton,
 * `GtkPopoverContent` for Popover/PopoverMenu/EmojiChooser), so `getParent()` is not the widget
 * itself. Every other allowlisted class parents the child directly and is asserted strictly.
 */
const internalContentParents = new Set(["menu-button", "popover", "popover-menu", "emoji-chooser"]);

await test("wave 1 single allowlist classes accept a child through setChild()", async () => {
  for (const type of allowlisted) {
    const definition = resolveIntrospected(type);
    assert.ok(definition, `${type} resolves`);
    assert.equal(definition.children, "single", `${type} is allowlisted as single`);
    const parent = definition.create();
    const app = createApp({ render: () => h(VLabel, null, { default: () => type }) });
    app.mount(createRoot(parent, type));
    try {
      const child = parent.getChild?.();
      assert.ok(child instanceof Gtk.Label, `${type} installs the child widget`);
      if (internalContentParents.has(type))
        assert.ok(contains(parent, child), `${type} owns the child in its GTK hierarchy`);
      else assert.equal(child.getParent(), parent, `${type} parents the child directly`);
    } finally {
      app.unmount();
    }
    assert.equal(parent.getChild?.(), null, `${type} detaches the child on unmount`);
  }
});

await test("VComboBoxText still rejects VNode children instead of appending an item", () => {
  assert.throws(
    () => mount(() => h("gtk-combo-box-text", null, [h(VLabel, null, { default: () => "item" })])),
    /vio: 'combo-box-text' cannot contain children/,
  );
});

await test("VToggleButton keeps v-model:active in sync in both directions", async () => {
  const active = ref(false);
  const app = mount(() =>
    h(
      VToggleButton,
      { active: active.value, "onUpdate:active": (value) => (active.value = value) },
      { default: () => h(VLabel, null, { default: () => "toggle" }) },
    ),
  );
  try {
    const button = widgetOf(app);
    assert.ok(button instanceof Gtk.ToggleButton);
    assert.equal(button.getActive(), false);

    active.value = true;
    await nextTick();
    assert.equal(button.getActive(), true, "a prop update reaches the GTK widget");

    button.setActive(false);
    await nextTick();
    assert.equal(active.value, false, "the toggled signal updates the model");
  } finally {
    app.unmount();
  }
});

await test("VLinkButton requires a uri and accepts one custom child", () => {
  const app = mount(() =>
    h(
      VLinkButton,
      { uri: "https://example.test/vio" },
      { default: () => h(VLabel, null, { default: () => "link child" }) },
    ),
  );
  try {
    const button = widgetOf(app);
    assert.ok(button instanceof Gtk.LinkButton);
    assert.equal(button.getUri(), "https://example.test/vio");
    assert.equal(button.getChild().getLabel(), "link child");
  } finally {
    app.unmount();
  }
});

await test("VMenuButton keeps the button child and the popover in separate slots", async () => {
  const popover = new Gtk.Popover();
  const propApp = mount(() =>
    h(VMenuButton, { popover }, { default: () => h(VLabel, null, { default: () => "button" }) }),
  );
  try {
    const button = widgetOf(propApp);
    assert.ok(button instanceof Gtk.MenuButton);
    assert.equal(button.getChild().getLabel(), "button");
    assert.equal(button.getPopover(), popover, "the popover prop reaches setPopover()");
    assert.notEqual(button.getChild(), popover, "setChild() and setPopover() are different slots");
  } finally {
    propApp.unmount();
  }

  const slotApp = mount(() =>
    h(VMenuButton, null, {
      default: () => h(VLabel, null, { default: () => "button" }),
      popover: () => h(VLabel, null, { default: () => "popup content" }),
    }),
  );
  try {
    const button = widgetOf(slotApp);
    const slotPopover = button.getPopover();
    assert.ok(slotPopover instanceof Gtk.Popover, "#popover is routed to setPopover()");
    assert.notEqual(slotPopover, button.getChild());
    assert.equal(slotPopover.getChild().getLabel(), "popup content");
  } finally {
    slotApp.unmount();
  }
});

await test("VExpander binds expanded and keeps #label separate from the content", async () => {
  const expanded = ref(false);
  const app = mount(() =>
    h(
      VExpander,
      {
        expanded: expanded.value,
        "onUpdate:expanded": (value) => (expanded.value = value),
      },
      {
        default: () => h(VLabel, null, { default: () => "content" }),
        label: () => h(VLabel, null, { default: () => "header" }),
      },
    ),
  );
  try {
    const expander = widgetOf(app);
    assert.ok(expander instanceof Gtk.Expander);
    assert.equal(expander.getChild().getLabel(), "content");
    assert.deepEqual(labelsIn(expander.getLabelWidget()), ["header"]);
    assert.notEqual(expander.getChild(), expander.getLabelWidget());

    expanded.value = true;
    await nextTick();
    assert.equal(expander.getExpanded(), true, "the model expands the widget");

    expander.setExpanded(false);
    await nextTick();
    assert.equal(expanded.value, false, "the notify::expanded signal updates the model");

    expander.notify("expanded");
    assert.equal(expanded.value, false);
  } finally {
    app.unmount();
  }
});

await test("VProgressBar binds value and text models", async () => {
  const value = ref(0);
  const text = ref("");
  const app = mount(() =>
    h(VProgressBar, {
      value: value.value,
      text: text.value,
      showText: true,
      "onUpdate:value": (next) => (value.value = next),
      "onUpdate:text": (next) => (text.value = next),
    }),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.ProgressBar);
    assert.equal(bar.getShowText(), true);

    value.value = 0.25;
    await nextTick();
    assert.equal(bar.getFraction(), 0.25);

    bar.setFraction(0.5);
    await nextTick();
    assert.equal(value.value, 0.5, "fraction changes update v-model:value");

    text.value = "half";
    await nextTick();
    assert.equal(bar.getText(), "half");

    bar.setText("native");
    await nextTick();
    assert.equal(text.value, "native", "text changes update v-model:text");
  } finally {
    app.unmount();
  }
});

await test("VLevelBar binds value and maps mode strings", async () => {
  const value = ref(0.2);
  const app = mount(() =>
    h(VLevelBar, {
      value: value.value,
      mode: "discrete",
      "onUpdate:value": (next) => (value.value = next),
    }),
  );
  try {
    const bar = widgetOf(app);
    assert.ok(bar instanceof Gtk.LevelBar);
    assert.equal(bar.getValue(), 0.2);
    assert.equal(bar.getMode(), Gtk.LevelBarMode.DISCRETE);

    value.value = 0.7;
    await nextTick();
    assert.equal(bar.getValue(), 0.7);

    bar.setValue(0.4);
    await nextTick();
    assert.equal(value.value, 0.4);
  } finally {
    app.unmount();
  }
});

await test("VScale binds value and configures the adjustment from props", async () => {
  const value = ref(20);
  const app = mount(() =>
    h(VScale, {
      value: value.value,
      min: 0,
      max: 100,
      step: 5,
      drawValue: true,
      orientation: "vertical",
      "onUpdate:value": (next) => (value.value = next),
    }),
  );
  try {
    const scale = widgetOf(app);
    assert.ok(scale instanceof Gtk.Scale);
    assert.equal(scale.getAdjustment().getLower(), 0);
    assert.equal(scale.getAdjustment().getUpper(), 100);
    assert.equal(scale.getAdjustment().getStepIncrement(), 5);
    assert.equal(scale.getDrawValue(), true);
    assert.equal(scale.getOrientation(), Gtk.Orientation.VERTICAL);
    assert.equal(scale.getValue(), 20);

    value.value = 35;
    await nextTick();
    assert.equal(scale.getValue(), 35, "prop changes reach the range widget");

    scale.setValue(60);
    await nextTick();
    assert.equal(value.value, 60, "native value changes update v-model:value");
  } finally {
    app.unmount();
  }
});

await test("VSpinButton binds a numeric value with digits and bounds", async () => {
  const value = ref(5);
  const app = mount(() =>
    h(VSpinButton, {
      value: value.value,
      min: 0,
      max: 10,
      step: 1,
      digits: 2,
      "onUpdate:value": (next) => (value.value = next),
    }),
  );
  try {
    const spin = widgetOf(app);
    assert.ok(spin instanceof Gtk.SpinButton);
    assert.equal(spin.getDigits(), 2);
    assert.equal(spin.getAdjustment().getLower(), 0);
    assert.equal(spin.getAdjustment().getUpper(), 10);
    assert.equal(spin.getValue(), 5);

    value.value = 7;
    await nextTick();
    assert.equal(spin.getValue(), 7);

    spin.setValue(8);
    await nextTick();
    assert.equal(value.value, 8);
  } finally {
    app.unmount();
  }
});

await test("VDropDown accepts a Gio.ListStore, tracks selection and clears the model", async () => {
  const store = Gio.ListStore.new(getGType(Gtk.StringObject));
  for (const value of ["one", "two", "three"]) store.append(Gtk.StringObject.new(value));
  const model = shallowRef(store);
  const selected = ref(0);
  const app = mount(() =>
    h(VDropDown, {
      model: model.value,
      modelValue: selected.value,
      "onUpdate:modelValue": (next) => (selected.value = next),
    }),
  );
  try {
    const dropDown = widgetOf(app);
    assert.ok(dropDown instanceof Gtk.DropDown);
    assert.equal(dropDown.getModel(), store);
    assert.equal(dropDown.getSelected(), 0);
    assert.equal(dropDown.getModel().getNItems(), 3);

    selected.value = 2;
    await nextTick();
    assert.equal(dropDown.getSelected(), 2);

    model.value = null;
    await nextTick();
    assert.equal(dropDown.getModel(), null, "setModel(null) clears the model");
  } finally {
    app.unmount();
  }
});

await test("VStackSwitcher and VStackSidebar require a stack prop and attach it", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.throws(
      () => mount(() => h(VStackSwitcher)),
      /vio: 'VStackSwitcher' requires a stack prop/,
    );
    assert.throws(
      () => mount(() => h(VStackSidebar)),
      /vio: 'VStackSidebar' requires a stack prop/,
    );
  } finally {
    console.warn = warn;
  }

  const stack = new Gtk.Stack();
  const switcherApp = mount(() => h(VStackSwitcher, { stack }));
  const sidebarApp = mount(() => h(VStackSidebar, { stack }));
  try {
    assert.equal(widgetOf(switcherApp).getStack(), stack);
    assert.equal(widgetOf(sidebarApp).getStack(), stack);
  } finally {
    switcherApp.unmount();
    sidebarApp.unmount();
  }
});

await test("VComboBoxText renders string items and binds the active id", async () => {
  const items = ref(["alpha", "beta", "gamma"]);
  const text = ref("beta");
  const app = mount(() =>
    h(VComboBoxText, {
      items: items.value,
      text: text.value,
      "onUpdate:text": (next) => (text.value = next),
    }),
  );
  try {
    const combo = widgetOf(app);
    assert.ok(combo instanceof Gtk.ComboBoxText);
    assert.equal(combo.getActiveId(), "beta");

    combo.setActive(0);
    await nextTick();
    assert.equal(text.value, "alpha", "selection updates v-model:text");

    items.value = ["one", "two"];
    await nextTick();
    combo.setActive(1);
    await nextTick();
    assert.equal(combo.getActiveId(), "two", "items are appended after removeAll()");
  } finally {
    app.unmount();
  }
});

await test("VPasswordEntry binds text and show-peek-icon", async () => {
  const text = ref("secret");
  const app = mount(() =>
    h(VPasswordEntry, {
      text: text.value,
      showPeekIcon: true,
      "onUpdate:text": (next) => (text.value = next),
    }),
  );
  try {
    const entry = widgetOf(app);
    assert.ok(entry instanceof Gtk.PasswordEntry);
    assert.equal(entry.getShowPeekIcon(), true);
    assert.equal(entry.getText(), "secret");

    text.value = "changed";
    await nextTick();
    assert.equal(entry.getText(), "changed");

    entry.setText("typed");
    await nextTick();
    assert.equal(text.value, "typed");
  } finally {
    app.unmount();
  }
});

await test("VPopoverMenu resets the menu model without Gtk warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gio from "gi:Gio-2.0";
    import { createApp, h, nextTick, shallowRef, VPopoverMenu } from "@zede/vio";
    Gtk.init();
    const menu = Gio.Menu.new();
    menu.append("Item", "app.item");
    const model = shallowRef(menu);
    let popover;
    const app = createApp({
      render: () => h(VPopoverMenu, { ref: (value) => (popover = value), menuModel: model.value }),
    });
    app.mount();
    if (popover.widget.getMenuModel() !== menu) throw new Error("menu model was not installed");
    model.value = null;
    await nextTick();
    if (popover.widget.getMenuModel() !== null) throw new Error("menu model was not cleared");
    app.unmount();
    console.log("popover-menu-ok");
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
  assert.equal(result.stdout.trim(), "popover-menu-ok");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});
