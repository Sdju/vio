import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import {
  VFrame,
  VViewport,
  VRevealer,
  VAspectFrame,
  VScrollbar,
  VScaleButton,
  VVolumeButton,
  VLockButton,
  VPopoverBin,
  VEmojiChooser,
  VShortcutLabel,
  VTreeExpander,
  VSvgWidget,
  VWindowControls,
  VWindowHandle,
  VColorChooserWidget,
  VFontChooserWidget,
  VGraphicsOffload,
  VBox,
  VLabel,
  createApp,
  getWidgetTypes,
  h,
  nextTick,
  shallowRef,
} from "@zede/vio";

Gtk.init();

const pump = (iterations = 300) => {
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
const mountSetup = (setup) => {
  const app = createApp({
    setup: () => {
      setup();
      return () => h("box");
    },
  });
  app.mount();
  return app;
};
const widgetOf = (app) => app.root.children[0].widget;
const isAncestor = (ancestor, child) => {
  for (let node = child.getParent(); node; node = node.getParent())
    if (node === ancestor) return true;
  return false;
};

const svgPath = "/tmp/vio-small-tiny.svg";
const svgMarkup =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#3366cc"/></svg>';
writeFileSync(svgPath, svgMarkup);

await test("VFrame maps label, content and the #label-widget slot", async () => {
  const label = shallowRef("Title");
  const labels = [];
  let handle;
  const app = mount(() =>
    h(
      VFrame,
      {
        ref: (value) => (handle = value),
        label: label.value,
        "onNotify::label": () => {
          labels.push("notify");
        },
      },
      { default: () => h(VLabel, null, { default: () => "body" }) },
    ),
  );
  await nextTick();
  const frame = widgetOf(app);
  assert.ok(frame instanceof Gtk.Frame);
  assert.equal(frame.getLabel(), "Title");
  assert.equal(frame.getChild().getLabel(), "body");
  assert.equal(handle.label, "Title");
  label.value = "Changed";
  await settle();
  assert.equal(frame.getLabel(), "Changed");
  frame.setLabel("Native");
  await settle();
  assert.ok(labels.includes("notify"), `notify::label is forwarded: ${labels}`);
  app.unmount();

  const slotted = mount(() =>
    h(
      VFrame,
      { ref: (value) => (handle = value) },
      {
        "label-widget": () => h(VLabel, null, { default: () => "slot label" }),
        default: () => h(VLabel, null, { default: () => "slot body" }),
      },
    ),
  );
  await nextTick();
  const withLabel = widgetOf(slotted);
  assert.ok(withLabel.getLabelWidget() instanceof Gtk.Box);
  assert.equal(withLabel.getLabel(), null, "the label widget replaces the plain label");
  assert.equal(withLabel.getChild().getLabel(), "slot body");
  assert.equal(handle.labelWidget, withLabel.getLabelWidget());
  slotted.unmount();
});

await test("VViewport hosts one child and exposes scrollTo without a scroll-to signal", async () => {
  let handle;
  const app = mount(() =>
    h(
      VViewport,
      { ref: (value) => (handle = value) },
      { default: () => h(VLabel, { heightRequest: 400 }, { default: () => "long" }) },
    ),
  );
  await settle();
  const viewport = widgetOf(app);
  assert.ok(viewport instanceof Gtk.Viewport);
  assert.equal(viewport.getChild().getLabel(), "long");
  assert.equal(typeof handle.scrollTo, "function");
  handle.scrollTo(viewport.getChild(), null);
  // GTK 4.24 has no GtkViewport::scroll-to signal; only the scrollTo() method exists.
  assert.throws(() => viewport.on("scroll-to", () => {}), /Signal name is invalid/);
  app.unmount();
});

await test("VRevealer maps transition props and v-model:revealed", async () => {
  const updates = [];
  const changes = [];
  let handle;
  const app = mount(() =>
    h(
      VRevealer,
      {
        ref: (value) => (handle = value),
        revealed: false,
        transitionType: "slide-up",
        transitionDuration: 0,
        "onUpdate:revealed": (value) => {
          updates.push(value);
        },
        onRevealedChanged: (value) => {
          changes.push(value);
        },
      },
      { default: () => h(VLabel, null, { default: () => "content" }) },
    ),
  );
  await settle();
  const revealer = widgetOf(app);
  assert.ok(revealer instanceof Gtk.Revealer);
  assert.equal(revealer.getRevealChild(), false);
  assert.equal(revealer.getChildRevealed(), false);
  assert.equal(revealer.getTransitionType(), Gtk.RevealerTransitionType.SLIDE_UP);
  assert.equal(revealer.getTransitionDuration(), 0);
  revealer.setRevealChild(true);
  await settle();
  assert.equal(handle.revealed, true);
  assert.equal(handle.childRevealed, true);
  assert.deepEqual(updates, [true]);
  assert.deepEqual(changes, [true]);
  app.unmount();

  const declared = shallowRef(false);
  const driven = mount(() =>
    h(
      VRevealer,
      { revealed: declared.value, transitionDuration: 0 },
      {
        default: () => h(VLabel, null, { default: () => "driven" }),
      },
    ),
  );
  await nextTick();
  declared.value = true;
  await settle();
  assert.equal(widgetOf(driven).getRevealChild(), true);
  driven.unmount();
});

await test("VAspectFrame gives box-mode children and maps ratio/obey-child/align", async () => {
  const ratio = shallowRef(2);
  const app = mount(() =>
    h(
      VAspectFrame,
      {
        ratio: ratio.value,
        obeyChild: false,
        xalign: 0.25,
        yalign: 0.75,
        shrinkChild: false,
      },
      {
        default: () => [
          h(VLabel, null, { default: () => "first" }),
          h(VLabel, null, { default: () => "second" }),
        ],
      },
    ),
  );
  await settle();
  const frame = widgetOf(app);
  assert.ok(frame instanceof Gtk.AspectFrame);
  const box = frame.getChild();
  assert.ok(box instanceof Gtk.Box);
  assert.equal(box.getFirstChild().getLabel(), "first");
  assert.equal(box.getLastChild().getLabel(), "second");
  assert.equal(frame.getRatio(), 2);
  assert.equal(frame.getObeyChild(), false);
  assert.equal(frame.getXalign(), 0.25);
  assert.equal(frame.getYalign(), 0.75);
  assert.equal(frame.getHexpand(), true, "shrink-child=false expands the frame");
  ratio.value = 1.5;
  await settle();
  assert.equal(frame.getRatio(), 1.5);
  app.unmount();
});

await test("VScrollbar drives its adjustment and emits v-model:value/value-changed", async () => {
  const value = shallowRef(20);
  const updates = [];
  const changes = [];
  let handle;
  const app = mount(() =>
    h(VScrollbar, {
      ref: (best) => (handle = best),
      value: value.value,
      min: 0,
      max: 50,
      step: 5,
      orientation: "horizontal",
      "onUpdate:value": (next) => {
        updates.push(next);
      },
      onValueChanged: (next) => {
        changes.push(next);
      },
    }),
  );
  await settle();
  const scrollbar = widgetOf(app);
  assert.ok(scrollbar instanceof Gtk.Scrollbar);
  assert.equal(scrollbar.getOrientation(), Gtk.Orientation.HORIZONTAL);
  assert.equal(handle.value, 20);
  assert.equal(handle.min, 0);
  assert.equal(handle.max, 50);
  assert.equal(scrollbar.getProperty("value"), undefined, "GtkScrollbar has no value property");
  assert.throws(() => scrollbar.on("value-changed", () => {}), /Signal name is invalid/);
  handle.adjustment.setValue(35);
  await settle();
  assert.equal(handle.value, 35);
  assert.deepEqual(updates, [35]);
  assert.deepEqual(changes, [35]);
  value.value = 10;
  await settle();
  assert.equal(handle.adjustment.getValue(), 10);
  assert.deepEqual(updates, [35], "a prop update does not echo through the model");
  app.unmount();
});

await test("VScaleButton maps icons/frame and binds value", async () => {
  const value = shallowRef(0.25);
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VScaleButton, {
      ref: (best) => (handle = best),
      value: value.value,
      icons: ["audio-volume-high-symbolic"],
      hasFrame: false,
      "onUpdate:value": (next) => {
        updates.push(next);
      },
    }),
  );
  await settle();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.ScaleButton);
  assert.equal(button.getValue(), 0.25);
  assert.deepEqual(button.icons, ["audio-volume-high-symbolic"]);
  assert.equal(button.getHasFrame(), false);
  assert.equal(handle.value, 0.25);
  button.setValue(0.75);
  await settle();
  assert.deepEqual(updates, [0.75]);
  value.value = 0.5;
  await settle();
  assert.equal(button.getValue(), 0.5);
  assert.deepEqual(updates, [0.75], "prop updates are not echoed");
  app.unmount();
});

await test("VScaleButton forwards popup and popdown listeners", async () => {
  const seen = [];
  const original = Gtk.ScaleButton.prototype.on;
  Gtk.ScaleButton.prototype.on = function (signal, callback, after) {
    if (signal === "popup" || signal === "popdown") seen.push(signal);
    return original.call(this, signal, callback, after);
  };
  const app = mount(() => h(VScaleButton, { value: 0.5, onPopup: () => {}, onPopdown: () => {} }));
  await nextTick();
  delete Gtk.ScaleButton.prototype.on;
  assert.ok(seen.includes("popup"), `popup listener is connected: ${seen}`);
  assert.ok(seen.includes("popdown"), `popdown listener is connected: ${seen}`);
  app.unmount();

  const events = [];
  let handle;
  const live = mount(() =>
    h(VScaleButton, {
      ref: (value) => (handle = value),
      value: 0.5,
      onPopdown: () => {
        events.push("popdown");
      },
    }),
  );
  await nextTick();
  handle.widget.emit("popdown");
  assert.deepEqual(events, ["popdown"], "popdown is forwarded from GTK");
  live.unmount();
});

await test("VVolumeButton keeps its default icons and binds value", async () => {
  const value = shallowRef(0.4);
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VVolumeButton, {
      ref: (best) => (handle = best),
      value: value.value,
      "onUpdate:value": (next) => {
        updates.push(next);
      },
    }),
  );
  await settle();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.VolumeButton);
  assert.equal(button.getValue(), 0.4);
  assert.equal(button.icons.length, 4);
  assert.equal(handle.adjustment.getUpper(), 1);
  button.setValue(0.9);
  await settle();
  assert.deepEqual(updates, [0.9]);
  value.value = 0.1;
  await settle();
  assert.equal(button.getValue(), 0.1);
  assert.deepEqual(updates, [0.9]);
  app.unmount();
});

await test("VLockButton binds a Gio.Permission and resets to null", async () => {
  const first = Gio.SimplePermission.new(true);
  const second = Gio.SimplePermission.new(false);
  const permission = shallowRef(first);
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VLockButton, {
      ref: (best) => (handle = best),
      permission: permission.value,
      "onUpdate:permission": (next) => {
        updates.push(next);
      },
    }),
  );
  await settle();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.LockButton);
  assert.equal(button.getPermission(), first);
  assert.equal(handle.permission, first);
  button.setPermission(second);
  await settle();
  assert.deepEqual(updates, [second]);
  permission.value = null;
  await settle();
  assert.equal(button.getPermission(), null);
  assert.equal(updates.length, 1, "clearing the prop is not echoed");
  app.unmount();
});

await test("VPopoverBin separates the default child and the #popover slot", async () => {
  let handle;
  const app = mount(() =>
    h(
      VPopoverBin,
      { ref: (value) => (handle = value) },
      {
        default: () => h(VLabel, null, { default: () => "bin child" }),
        popover: () =>
          h("popover", { role: "popover" }, [h(VLabel, null, { default: () => "pop" })]),
      },
    ),
  );
  await settle();
  const bin = widgetOf(app);
  assert.ok(bin instanceof Gtk.PopoverBin);
  assert.equal(bin.getChild().getLabel(), "bin child");
  assert.ok(bin.getPopover() instanceof Gtk.Popover);
  assert.equal(bin.getPopover(), handle.popover);
  assert.equal(handle.child, bin.getChild());
  app.unmount();
});

await test("VEmojiChooser forwards emoji-picked and guards unparented popup", async () => {
  const picked = [];
  let handle;
  const app = mount(() =>
    h(VEmojiChooser, {
      ref: (value) => (handle = value),
      onEmojiPicked: (text) => {
        picked.push(text);
      },
    }),
  );
  await settle();
  const chooser = widgetOf(app);
  assert.ok(chooser instanceof Gtk.EmojiChooser);
  assert.equal(typeof handle.popup, "function");
  assert.equal(typeof handle.popdown, "function");
  assert.equal(handle.popup(), false, "an unparented chooser is not popped");
  chooser.emit("emoji-picked", "😀");
  assert.deepEqual(picked, ["😀"]);
  app.unmount();
});

await test("VShortcutLabel maps accelerator and disabled text", async () => {
  const accelerator = shallowRef("<Control>s");
  const app = mount(() =>
    h(VShortcutLabel, { accelerator: accelerator.value, disabledText: "Disabled" }),
  );
  await nextTick();
  const label = widgetOf(app);
  assert.ok(label instanceof Gtk.ShortcutLabel);
  assert.equal(label.getAccelerator(), "<Control>s");
  assert.equal(label.getDisabledText(), "Disabled");
  accelerator.value = "<Control><Shift>q";
  await settle();
  assert.equal(label.getAccelerator(), "<Control><Shift>q");
  app.unmount();
});

await test("VTreeExpander maps the renamed indent property and its child", async () => {
  let handle;
  const app = mount(() =>
    h(
      VTreeExpander,
      {
        ref: (value) => (handle = value),
        indentForIcon: false,
        indentForExpander: false,
        hideExpander: true,
      },
      { default: () => h(VLabel, null, { default: () => "row" }) },
    ),
  );
  await nextTick();
  const expander = widgetOf(app);
  assert.ok(expander instanceof Gtk.TreeExpander);
  assert.equal(expander.getChild().getLabel(), "row");
  assert.equal(expander.getIndentForIcon(), false);
  assert.equal(expander.getIndentForDepth(), false);
  assert.equal(expander.getHideExpander(), true);
  assert.equal(handle.item, null);
  assert.equal(
    expander.getProperty("indent-for-expander"),
    undefined,
    "GTK 4.24 renamed it to indent-for-depth",
  );
  app.unmount();
});

await test("VSvgWidget loads a file, accepts bytes and reports a missing file", async () => {
  let handle;
  const app = mount(() => h(VSvgWidget, { ref: (value) => (handle = value), filename: svgPath }));
  await settle();
  const widget = widgetOf(app);
  assert.ok(widget instanceof Gtk.SvgWidget);
  assert.equal(handle.error, null);
  assert.ok(handle.svg instanceof Gtk.Svg);
  assert.equal(handle.paintable, handle.svg);
  assert.equal(
    widget.getProperty("paintable"),
    undefined,
    "GtkSvgWidget 4.24 exposes a GtkSvg through the svg property, not paintable",
  );
  assert.equal(widget.getProperty("file"), undefined);
  app.unmount();

  const bytes = GLib.Bytes.new(Array.from(Buffer.from(svgMarkup, "utf8")));
  const fromBytes = mount(() =>
    h(VSvgWidget, {
      ref: (value) => (handle = value),
      bytes,
      state: 2,
      stylesheet: "rect { fill: #3366cc; }",
    }),
  );
  await settle();
  assert.equal(handle.error, null);
  assert.equal(widgetOf(fromBytes).getState(), 2);
  assert.ok(widgetOf(fromBytes).getStylesheet() instanceof GLib.Bytes);
  fromBytes.unmount();

  const missing = mount(() =>
    h(VSvgWidget, { ref: (value) => (handle = value), filename: "/tmp/vio-small-missing.svg" }),
  );
  await settle();
  assert.match(handle.error, /not found/);
  missing.unmount();
});

await test("VWindowControls and VWindowHandle map custom titlebar props", async () => {
  let controls;
  let handle;
  const app = mount(() =>
    h(VBox, null, {
      default: () => [
        h(VWindowControls, {
          ref: (value) => (controls = value),
          side: "end",
          decorationLayout: "icon:close",
          useNativeControls: false,
        }),
        h(
          VWindowHandle,
          { ref: (value) => (handle = value) },
          { default: () => h(VLabel, null, { default: () => "draggable" }) },
        ),
      ],
    }),
  );
  await nextTick();
  const box = widgetOf(app);
  const windowControls = box.getFirstChild();
  const windowHandle = box.getLastChild();
  assert.ok(windowControls instanceof Gtk.WindowControls);
  assert.ok(windowHandle instanceof Gtk.WindowHandle);
  assert.equal(windowControls.getSide(), Gtk.PackType.END);
  assert.equal(windowControls.getDecorationLayout(), "icon:close");
  assert.equal(windowControls.getUseNativeControls(), false);
  assert.equal(controls.side, Gtk.PackType.END);
  assert.equal(windowHandle.getChild().getLabel(), "draggable");
  assert.equal(handle.child, windowHandle.getChild());
  app.unmount();

  const hidden = mount(() => h(VWindowControls, { side: "start", decorative: false }));
  await nextTick();
  assert.equal(widgetOf(hidden).getVisible(), false, "decorative=false hides the controls");
  hidden.unmount();
});

await test("VGraphicsOffload maps enabled state, background and child", async () => {
  const app = mount(() =>
    h(
      VGraphicsOffload,
      { enabled: "disabled", blackBackground: true },
      { default: () => h(VLabel, null, { default: () => "offload" }) },
    ),
  );
  await nextTick();
  const offload = widgetOf(app);
  assert.ok(offload instanceof Gtk.GraphicsOffload);
  assert.equal(offload.getEnabled(), Gtk.GraphicsOffloadEnabled.DISABLED);
  assert.equal(offload.getBlackBackground(), true);
  assert.equal(offload.getChild().getLabel(), "offload");
  app.unmount();
});

await test("VColorChooserWidget binds rgba and maps editor flags", async () => {
  const rgba = shallowRef("#3366cc");
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VColorChooserWidget, {
      ref: (value) => (handle = value),
      rgba: rgba.value,
      showEditor: true,
      useAlpha: true,
      "onUpdate:rgba": (next) => {
        updates.push(next);
      },
    }),
  );
  await nextTick();
  const chooser = widgetOf(app);
  assert.ok(chooser instanceof Gtk.ColorChooserWidget);
  assert.equal(chooser.getRgba().toString(), "rgb(51,102,204)");
  assert.equal(chooser.showEditor, true);
  assert.equal(chooser.getUseAlpha(), true);
  assert.equal(handle.rgba.toString(), "rgb(51,102,204)");
  const red = new Gdk.RGBA();
  red.parse("#ff0000");
  chooser.emit("color-activated", red);
  await settle();
  assert.equal(updates.length, 1, "color-activated is forwarded once");
  assert.equal(updates[0].toString(), "rgb(255,0,0)");
  rgba.value = "#00ff00";
  await settle();
  assert.equal(chooser.getRgba().green, 1);
  app.unmount();
});

await test("VFontChooserWidget applies font props and emits font-activated", async () => {
  const updates = [];
  let handle;
  const level = Gtk.FontChooserLevel.STYLE | Gtk.FontChooserLevel.SIZE;
  const app = mount(() =>
    h(VFontChooserWidget, {
      ref: (value) => (handle = value),
      font: "Sans 12",
      language: "en",
      level,
      previewText: "Preview",
      showPreviewEntry: true,
      "onUpdate:font": (next) => {
        updates.push(next);
      },
    }),
  );
  await nextTick();
  const chooser = widgetOf(app);
  assert.ok(chooser instanceof Gtk.FontChooserWidget);
  assert.equal(chooser.getLanguage(), "en");
  assert.equal(chooser.getLevel(), level);
  assert.equal(chooser.getPreviewText(), "Preview");
  assert.equal(chooser.getShowPreviewEntry(), true);
  chooser.emit("font-activated", "Serif 14");
  assert.deepEqual(updates, ["Serif 14"]);
  assert.equal(handle.widget, chooser);
  app.unmount();
});

await test("wave 5 components mount and unmount without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gio from "gi:Gio-2.0";
    import {
      createApp, h, VBox, VLabel,
      VFrame, VViewport, VRevealer, VAspectFrame, VScrollbar, VScaleButton,
      VVolumeButton, VLockButton, VPopoverBin, VEmojiChooser, VShortcutLabel,
      VTreeExpander, VSvgWidget, VWindowControls, VWindowHandle, VGraphicsOffload,
      VColorChooserWidget, VFontChooserWidget,
      getWidgetTypes,
    } from "@zede/vio";
    Gtk.init();
    const app = createApp({
      setup: () => () => h(VBox, null, {
        default: () => [
          h(VFrame, { label: "frame" }, { default: () => h(VLabel, null, { default: () => "body" }) }),
          h(VViewport, null, { default: () => h(VLabel, null, { default: () => "viewport" }) }),
          h(VRevealer, { revealed: true, transitionType: "crossfade", transitionDuration: 0 }, {
            default: () => h(VLabel, null, { default: () => "revealed" }),
          }),
          h(VAspectFrame, { ratio: 1.5 }, { default: () => h(VLabel, null, { default: () => "aspect" }) }),
          h(VScrollbar, { value: 10, min: 0, max: 100 }),
          h(VScaleButton, { value: 0.5, icons: ["audio-volume-high-symbolic"] }),
          h(VVolumeButton, { value: 0.5 }),
          h(VLockButton, { permission: Gio.SimplePermission.new(true) }),
          h(VPopoverBin, null, {
            default: () => h(VLabel, null, { default: () => "bin" }),
            popover: () => h("popover", { role: "popover" }, [h(VLabel, null, { default: () => "pop" })]),
          }),
          h(VEmojiChooser, null),
          h(VShortcutLabel, { accelerator: "<Control>s", disabledText: "None" }),
          h(VTreeExpander, { indentForIcon: true, indentForDepth: false }, {
            default: () => h(VLabel, null, { default: () => "row" }),
          }),
          h(VSvgWidget, { filename: "/tmp/vio-small-missing.svg" }),
          h(VWindowControls, { side: "end" }),
          h(VWindowHandle, null, { default: () => h(VLabel, null, { default: () => "handle" }) }),
          h(VColorChooserWidget, { rgba: "#112233" }),
          h(VFontChooserWidget, { font: "Sans 10" }),
          h(VGraphicsOffload, { enabled: "disabled" }, {
            default: () => h(VLabel, null, { default: () => "offload" }),
          }),
        ],
      }),
    });
    app.mount();
    const types = getWidgetTypes();
    app.unmount();
    console.log(JSON.stringify({
      explicit: types.length,
      small: types.filter((type) => type.startsWith("vio-")).length,
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
  assert.ok(report.small >= 2, `explicit wave 5 registrations are present: ${report}`);
});

await test("window-hosted scale popups forward popdown without warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, VWindow, VBox, VScaleButton } from "@zede/vio";
    Gtk.init();
    const pump = (n = 200) => { for (let index = 0; index < n; index++) GLib.MainContext.default().iteration(false); };
    const events = [];
    let handle;
    const app = createApp({
      setup: () => () => h(VWindow, { title: "small", defaultWidth: 240, defaultHeight: 160, visible: true }, {
        default: () => h(VBox, { orientation: 1 }, {
          default: () => [
            h(VScaleButton, {
              ref: (value) => (handle = value),
              value: 0.5,
              onPopdown: () => { events.push("popdown"); },
            }),
          ],
        }),
      }),
    });
    app.mount();
    const end = Date.now() + 500;
    while (Date.now() < end) {
      pump(30);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    handle.widget.emit("popdown");
    console.log(JSON.stringify({ events, realized: handle.widget.getRealized() }));
    app.unmount();
    pump();
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
  assert.equal(report.realized, true);
  assert.deepEqual(report.events, ["popdown"]);
});
