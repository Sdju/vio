import assert from "node:assert/strict";
import { test } from "node:test";
import Gtk from "gi:Gtk-4.0";
import {
  createApp,
  createRoot,
  getWidgetTypes,
  h,
  isIntrospectedType,
  listIntrospectedWidgetTypes,
  resolveIntrospected,
  VBox,
  VLabel,
  VWindow,
} from "@zede/vio";

Gtk.init();

const children = (widget) => {
  const result = [];
  for (let child = widget?.getFirstChild(); child; child = child.getNextSibling())
    result.push(child);
  return result;
};
const mount = (render) => {
  const app = createApp({ render });
  app.mount();
  return app;
};
const windowOf = (app) => app.root.children[0].widget;

await test("introspected widgets list Gtk classes and resolve definitions lazily", () => {
  const types = listIntrospectedWidgetTypes();
  assert.ok(types.includes("calendar"), "calendar is introspected");
  assert.ok(types.includes("picture"), "picture is introspected");
  assert.ok(types.length > 60, `the Gtk widget namespace is complete (${types.length})`);
  assert.equal(isIntrospectedType("calendar"), true);
  assert.equal(isIntrospectedType("gtk-calendar"), true, "the gtk- prefix is accepted too");
  assert.equal(isIntrospectedType("combobox-text"), true, "the GTK CSS spelling is accepted");
  assert.equal(isIntrospectedType("css-provider"), false, "a non-widget class is not introspected");
  assert.equal(resolveIntrospected("no-such-widget"), undefined);

  const definition = resolveIntrospected("calendar");
  assert.ok(definition, "calendar has a definition");
  assert.equal(definition.children, "none");
  assert.ok(definition.create() instanceof Gtk.Calendar, "create() builds the native class");
  const frame = resolveIntrospected("frame");
  assert.equal(frame.children, "single");
  assert.equal(resolveIntrospected("popover-menu").children, "single");
  assert.equal(resolveIntrospected("combo-box-text").children, "none");
});

await test("gtk-calendar is created with props through the generic resolver", () => {
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VBox, null, {
          default: () =>
            h("gtk-calendar", { showHeading: false, showWeekNumbers: true, class: "calendar" }),
        }),
    }),
  );
  try {
    const calendar = children(windowOf(app).getChild())[0];
    assert.ok(calendar instanceof Gtk.Calendar);
    assert.equal(calendar.getShowHeading(), false);
    assert.equal(calendar.getShowWeekNumbers(), true);
    assert.ok(calendar.getCssClasses().includes("calendar"));
  } finally {
    app.unmount();
  }
});

await test("gtk-frame accepts one child and rejects a second one with a clear error", async () => {
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h("gtk-frame", { label: "frame" }, [h(VLabel, null, { default: () => "inside" })]),
    }),
  );
  try {
    const frame = windowOf(app).getChild();
    assert.ok(frame instanceof Gtk.Frame);
    assert.equal(frame.getLabel(), "frame");
    assert.equal(frame.getChild().getLabel(), "inside");
  } finally {
    app.unmount();
  }

  const invalid = createApp({
    render: () =>
      h("gtk-frame", null, [
        h(VLabel, { key: "one" }, { default: () => "one" }),
        h(VLabel, { key: "two" }, { default: () => "two" }),
      ]),
  });
  assert.throws(
    () => invalid.mount(),
    /vio: 'frame' accepts one widget child; wrap siblings in VBox/,
  );
});

await test("the explicit box registration keeps accepting several children", () => {
  const app = mount(() =>
    h(VWindow, null, {
      default: () =>
        h(VBox, null, {
          default: () => [
            h(VLabel, { key: "a" }, { default: () => "a" }),
            h(VLabel, { key: "b" }, { default: () => "b" }),
          ],
        }),
    }),
  );
  try {
    const box = windowOf(app).getChild();
    assert.ok(box instanceof Gtk.Box);
    assert.deepEqual(
      children(box).map((label) => label.getLabel()),
      ["a", "b"],
    );
  } finally {
    app.unmount();
  }
});

await test("unknown classes list nearby introspected names", () => {
  let message = "";
  try {
    mount(() => h("gtk-no-such-widget"));
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /vio: unknown widget 'no-such-widget'/);
  const [prefix, list] = message.split("Did you mean ");
  assert.equal(prefix.trim().endsWith("no such Gtk class."), true);
  const suggestions = list.replace(/\?$/, "").split(", ");
  assert.ok(suggestions.length >= 3 && suggestions.length <= 5, message);
  const known = new Set(listIntrospectedWidgetTypes());
  for (const suggestion of suggestions) assert.ok(known.has(suggestion), suggestion);
});

await test("non-widget Gtk classes are rejected with a targeted error", () => {
  assert.throws(
    () => mount(() => h("gtk-css-provider")),
    /vio: 'css-provider' is not a Gtk\.Widget/,
  );
});

await test("ComboBoxText rejects a widget child instead of adding a string item", () => {
  assert.throws(
    () =>
      mount(() =>
        h("gtk-combo-box-text", null, [h(VLabel, null, { default: () => "not an item" })]),
      ),
    /vio: 'combo-box-text' cannot contain children/,
  );
});

await test("generic use does not grow the explicit widget registry", () => {
  const before = getWidgetTypes();
  const app = mount(() =>
    h(VWindow, null, {
      default: () => h("gtk-calendar"),
    }),
  );
  app.unmount();
  assert.deepEqual(getWidgetTypes(), before);
  assert.equal(getWidgetTypes().includes("calendar"), false);
});

await test("createRoot infers child modes for introspected Calendar and Frame widgets", () => {
  const calendarRoot = createRoot(new Gtk.Calendar());
  const empty = createApp({ render: () => null });
  empty.mount(calendarRoot);
  assert.ok(calendarRoot.widget instanceof Gtk.Calendar);
  empty.unmount();

  const calendarWithChild = createApp({
    render: () => h(VLabel, null, { default: () => "not a child" }),
  });
  assert.throws(
    () => calendarWithChild.mount(createRoot(new Gtk.Calendar())),
    (error) =>
      /cannot contain children/.test(error.message) &&
      !/setChild is not a function/.test(error.message),
  );

  const frameRoot = createRoot(new Gtk.Frame());
  const frameApp = createApp({
    render: () => h(VLabel, null, { default: () => "rooted" }),
  });
  frameApp.mount(frameRoot);
  assert.equal(frameRoot.widget.getChild().getLabel(), "rooted");
  frameApp.unmount();
  assert.equal(frameRoot.widget.getChild(), null);
});
