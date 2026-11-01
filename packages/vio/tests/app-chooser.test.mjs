import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import GLib from "gi:GLib-2.0";
import {
  VAppChooserButton,
  VAppChooserWidget,
  VBox,
  createApp,
  gtkDriver,
  h,
  nextTick,
  resolveIntrospected,
} from "@zede/vio";

Gtk.init();

const pump = (iterations = 200) => {
  for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  pump();
};
const mount = (render) => {
  const app = createApp({ setup: () => render });
  app.mount();
  return app;
};
const widgetOf = (app) => app.root.children[0].widget;
const appInfo = () =>
  Gio.AppInfo.getDefaultForType("image/png", false) ??
  Gio.AppInfo.getRecommendedForType("image/png")[0] ??
  null;

await test("construct-only props reach constructors on both creation paths", () => {
  const direct = gtkDriver.create("app-chooser-button", { contentType: "image/png" });
  assert.ok(direct instanceof Gtk.AppChooserButton);
  assert.equal(direct.getContentType(), "image/png");

  const definition = resolveIntrospected("app-chooser-button");
  assert.ok(definition);
  assert.ok(definition.constructProps?.includes("content-type"));
  assert.ok(definition.constructProps?.includes("css-name"), "Widget:css-name is construct-only");
  const introspected = definition.create({ contentType: "image/png" });
  assert.ok(introspected instanceof Gtk.AppChooserButton);
  assert.equal(introspected.getContentType(), "image/png");

  const widget = gtkDriver.create("app-chooser-widget", { contentType: "image/png" });
  assert.ok(widget instanceof Gtk.AppChooserWidget);
  assert.equal(widget.getContentType(), "image/png");
});

await test("construct-only props are applied before insertion and rejected after it", () => {
  const node = {
    kind: "element",
    type: "app-chooser-button",
    widget: gtkDriver.create("app-chooser-button"),
    parent: null,
    children: [],
    props: {},
    text: "",
    patching: 0,
    events: new Map(),
  };
  node.props.contentType = "image/png";
  gtkDriver.patchProp(node, "contentType", undefined, "image/png");
  assert.equal(
    node.widget.getContentType(),
    "image/png",
    "the widget is recreated before insertion",
  );

  node.parent = { kind: "root", widget: new Gtk.Box() };
  assert.throws(
    () => gtkDriver.patchProp(node, "contentType", "image/png", "text/plain"),
    /construct-only and cannot change after the widget is inserted/,
  );
});

await test("gtk-app-chooser-button and gtk-app-chooser-widget accept content-type", async () => {
  const app = mount(() =>
    h(VBox, null, {
      default: () => [
        h("gtk-app-chooser-button", { contentType: "image/png" }),
        h("gtk-app-chooser-button", { "content-type": "image/png" }),
        h("gtk-app-chooser-widget", { contentType: "image/png", showAll: true }),
      ],
    }),
  );
  await nextTick();
  const box = widgetOf(app);
  assert.equal(box.getFirstChild().getContentType(), "image/png");
  assert.equal(box.getFirstChild().getNextSibling().getContentType(), "image/png");
  assert.equal(box.getLastChild().getContentType(), "image/png");
  assert.equal(box.getLastChild().getShowAll(), true);
  app.unmount();
});

await test("VAppChooserButton maps props, handle methods and signals", async () => {
  const events = [];
  let handle;
  const app = mount(() =>
    h(VAppChooserButton, {
      ref: (value) => (handle = value),
      contentType: "image/png",
      heading: "Open with",
      modal: true,
      showDialogItem: true,
      showDefaultItem: true,
      onCustomItemActivated: (name) => {
        events.push(["custom", name]);
      },
      onActivate: () => {
        events.push(["activate"]);
      },
    }),
  );
  await settle();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.AppChooserButton);
  assert.equal(button.getContentType(), "image/png");
  assert.equal(button.getHeading(), "Open with");
  assert.equal(button.getModal(), true);
  assert.equal(button.getShowDialogItem(), true);
  assert.equal(button.getShowDefaultItem(), true);
  assert.equal(handle.available, true);
  assert.equal(handle.error, null);
  assert.equal(handle.contentType, "image/png");
  assert.equal(handle.heading, "Open with");
  assert.equal(handle.modal, true);

  handle.appendSeparator();
  handle.appendCustomItem("custom", "Custom", Gio.ThemedIcon.new("application-x-executable"));
  handle.activate();
  button.emit("custom-item-activated", "custom", null);
  button.emit("activate");
  await settle();
  assert.ok(events.some(([name]) => name === "custom"));
  assert.ok(events.some(([name]) => name === "activate"));

  assert.throws(
    () => gtkDriver.patchProp(handle.element, "contentType", "image/png", "text/plain"),
    /construct-only/,
  );
  app.unmount();
});

await test("VAppChooserWidget maps flags and forwards application signals", async () => {
  const events = [];
  let handle;
  const app = mount(() =>
    h(VAppChooserWidget, {
      ref: (value) => (handle = value),
      contentType: "image/png",
      showDefault: true,
      showFallback: true,
      showOther: true,
      showRecommended: true,
      showAll: true,
      onApplicationSelected: (info) => {
        events.push(["selected", info?.getName?.() ?? null]);
      },
      onApplicationActivated: (info) => {
        events.push(["activated", info?.getName?.() ?? null]);
      },
    }),
  );
  await settle();
  const chooser = widgetOf(app);
  assert.ok(chooser instanceof Gtk.AppChooserWidget);
  assert.equal(chooser.getContentType(), "image/png");
  assert.equal(chooser.getShowDefault(), true);
  assert.equal(chooser.getShowFallback(), true);
  assert.equal(chooser.getShowOther(), true);
  assert.equal(chooser.getShowRecommended(), true);
  assert.equal(chooser.getShowAll(), true);
  assert.equal(handle.available, true);
  assert.equal(handle.error, null);
  assert.equal(handle.contentType, "image/png");
  assert.equal(handle.showAll, true);

  const info = appInfo();
  if (info) {
    chooser.emit("application-selected", info);
    chooser.emit("application-activated", info);
    assert.ok(events.some(([name]) => name === "selected"));
    assert.ok(events.some(([name]) => name === "activated"));
  }
  app.unmount();
});

await test("invalid content types expose an empty state without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import { createApp, h, VAppChooserButton, VAppChooserWidget } from "@zede/vio";
    Gtk.init();
    let button;
    let widget;
    const app = createApp({
      setup: () => () => h("box", null, {
        default: () => [
          h(VAppChooserButton, { ref: (value) => (button = value), contentType: "nonsense" }),
          h(VAppChooserWidget, { ref: (value) => (widget = value), contentType: "nonsense" }),
        ],
      }),
    });
    app.mount();
    console.log(JSON.stringify({
      button: {
        error: button.error,
        available: button.available,
        contentType: button.widget.getContentType(),
      },
      widget: {
        error: widget.error,
        available: widget.available,
        contentType: widget.widget.getContentType(),
      },
    }));
    app.unmount();
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
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
  assert.doesNotMatch(result.stderr, /GLib-CRITICAL|GLib-GObject-CRITICAL|Gdk-CRITICAL/);
  const report = JSON.parse(result.stdout.trim());
  assert.match(report.button.error, /invalid content type/);
  assert.equal(report.button.available, false);
  assert.equal(report.button.contentType, "");
  assert.match(report.widget.error, /invalid content type/);
  assert.equal(report.widget.available, false);
  assert.equal(report.widget.contentType, "");
});

await test("wave 6 AppChooser components mount and unmount without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import { createApp, h, VBox, VAppChooserButton, VAppChooserWidget, getWidgetTypes } from "@zede/vio";
    Gtk.init();
    const app = createApp({
      setup: () => () => h(VBox, null, {
        default: () => [
          h(VAppChooserButton, { contentType: "image/png", heading: "Open", modal: true }),
          h(VAppChooserWidget, { contentType: "image/png", showRecommended: true }),
          h("gtk-app-chooser-button", { contentType: "image/png" }),
          h("gtk-app-chooser-widget", { contentType: "image/png" }),
        ],
      }),
    });
    app.mount();
    const types = getWidgetTypes();
    app.unmount();
    console.log(JSON.stringify({
      explicit: types.length,
      chooser: types.filter((type) => type.includes("app-chooser")).length,
    }));
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
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
  assert.doesNotMatch(result.stderr, /GLib-CRITICAL|GLib-GObject-CRITICAL|Gdk-CRITICAL/);
  const report = JSON.parse(result.stdout.trim());
  assert.ok(report.chooser >= 2, `explicit AppChooser registrations are present: ${report}`);
});
