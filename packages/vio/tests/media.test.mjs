import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import Pango from "gi:Pango-1.0";
import GL from "gi:GL-1.0";
import Cairo from "gi:cairo";
import { getGType } from "node-gtk";
import { requiresGtk } from "./gtk-version.mjs";
import {
  VPicture,
  VMediaFile,
  VVideo,
  VMediaControls,
  VDrawingArea,
  VGLArea,
  VColorButton,
  VFontButton,
  VColorDialogButton,
  VFontDialogButton,
  VCalendar,
  VStringList,
  VFilterListModel,
  VSortListModel,
  createApp,
  getWidgetTypes,
  h,
  nextTick,
  ref,
  toStringList,
  useMultiSelection,
  useNoSelection,
  useSingleSelection,
} from "@zede/vio";

// GStreamer is initialized only here, in the media suite. A missing GStreamer runtime or a
// partial plugin set must not fail the suite: the assertions below check state, not playback.
try {
  const Gst = (await import("gi:Gst-1.0")).default;
  Gst.init([]);
} catch {
  // No GStreamer runtime: media widgets must still mount and expose an empty stream.
}

Gtk.init();

const tonePath = "/tmp/vio-media-tone.wav";
{
  const sampleRate = 8000;
  const length = Math.round(sampleRate * 0.2);
  const data = Buffer.alloc(length * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(tonePath, Buffer.concat([header, data]));
}
const pngPath = "/tmp/vio-media-picture.png";
{
  const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 8, 8);
  surface.writeToPng(pngPath);
}

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
const withoutWarnings = (action) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return action();
  } finally {
    console.warn = warn;
  }
};
const stringStore = (values) => {
  const store = Gio.ListStore.new(getGType(Gtk.StringObject));
  for (const value of values) store.append(Gtk.StringObject.new(value));
  return store;
};

await test("VPicture maps paintable, filename convenience and content-fit", async () => {
  let handle;
  const app = mount(() =>
    h(VPicture, {
      ref: (value) => (handle = value),
      filename: pngPath,
      contentFit: "cover",
      canShrink: false,
      keepAspectRatio: true,
      alternativeText: "pixel",
    }),
  );
  await nextTick();
  const picture = widgetOf(app);
  assert.ok(picture instanceof Gtk.Picture);
  assert.equal(picture.getContentFit(), Gtk.ContentFit.COVER);
  assert.equal(picture.getCanShrink(), false);
  assert.equal(picture.getKeepAspectRatio(), true);
  assert.equal(picture.getAlternativeText(), "pixel");
  assert.ok(picture.getPaintable() instanceof Gdk.Texture);
  assert.equal(picture.getPaintable().getWidth(), 8);
  assert.equal(handle.widget, picture);
  app.unmount();

  let broken;
  const missing = mount(() =>
    h(VPicture, { ref: (value) => (broken = value), filename: "/tmp/vio-media-missing.png" }),
  );
  await nextTick();
  assert.equal(widgetOf(missing).getPaintable(), null, "a missing file leaves the picture empty");
  missing.unmount();

  assert.throws(
    () =>
      withoutWarnings(() => mount(() => h(VPicture, { filename: pngPath, contentFit: "stretch" }))),
    /unknown content-fit/,
  );
});

await test("VPicture rejects paintable together with file and filename", () => {
  assert.throws(
    () =>
      withoutWarnings(() =>
        mount(() => h(VPicture, { paintable: new Gdk.RGBA(), filename: pngPath })),
      ),
    /either 'paintable'/,
  );
});

await test("VMediaFile exposes state, tolerates a missing file and never plays it", async () => {
  const updates = [];
  const ended = [];
  let handle;
  const app = mount(() =>
    h(VMediaFile, {
      ref: (value) => (handle = value),
      filename: "/tmp/vio-media-missing.wav",
      "onUpdate:playing": (value) => updates.push(value),
      onEnded: () => ended.push(true),
    }),
  );
  await nextTick();
  assert.equal(handle.available, false);
  assert.equal(handle.mediaFile, null);
  assert.match(handle.error, /not found/);
  assert.equal(handle.play(), false, "a missing file is never handed to GStreamer");
  app.unmount();

  const live = mount(() =>
    h(VMediaFile, {
      ref: (value) => (handle = value),
      filename: tonePath,
      playing: false,
      "onUpdate:playing": (value) => updates.push(value),
    }),
  );
  await nextTick();
  assert.equal(handle.available, true);
  assert.ok(handle.mediaFile instanceof Gtk.MediaFile);
  assert.equal(handle.error, null);
  assert.equal(typeof handle.duration, "number");
  assert.equal(typeof handle.timestamp, "number");
  assert.equal(handle.mediaFile.getLoop(), false);
  assert.equal(handle.play(), true);
  assert.equal(handle.mediaFile.getPlaying(), true);
  assert.ok(updates.includes(true), "playing-changed updates the v-model");
  assert.equal(handle.pause(), true);
  assert.equal(handle.seek(0), true);
  live.unmount();
});

await test("VVideo binds a media stream, applies autoplay/loop and stays empty on a missing file", async () => {
  let handle;
  const app = mount(() =>
    h(VVideo, { ref: (value) => (handle = value), filename: tonePath, loop: true }),
  );
  await settle();
  const video = widgetOf(app);
  assert.ok(video instanceof Gtk.Video);
  assert.equal(video.getLoop(), true);
  assert.equal(handle.mediaStream, video.getMediaStream());
  assert.ok(handle.mediaStream instanceof Gtk.MediaStream);
  app.unmount();

  const missing = mount(() =>
    h(VVideo, { ref: (value) => (handle = value), filename: "/tmp/vio-media-missing.mp4" }),
  );
  await settle();
  assert.equal(widgetOf(missing).getMediaStream(), null);
  assert.match(handle.error, /not found/);
  missing.unmount();

  const autoplay = mount(() =>
    h(VVideo, { ref: (value) => (handle = value), filename: tonePath, autoplay: true }),
  );
  await nextTick();
  const auto = widgetOf(autoplay);
  assert.equal(auto.getAutoplay(), true);
  assert.ok(auto.getMediaStream() != null);
  assert.equal(handle.mediaStream, auto.getMediaStream());
  autoplay.unmount();
});

await test("VMediaControls attaches a VMediaFile handle and mirrors its playing state", async () => {
  let media;
  const source = mount(() =>
    h(VMediaFile, { ref: (value) => (media = value), filename: tonePath }),
  );
  await nextTick();
  const updates = [];
  let controls;
  const app = mount(() =>
    h(VMediaControls, {
      ref: (value) => (controls = value),
      mediaStream: media,
      playing: false,
      "onUpdate:playing": (value) => updates.push(value),
    }),
  );
  const widget = widgetOf(app);
  assert.ok(widget instanceof Gtk.MediaControls);
  assert.equal(widget.getMediaStream(), media.mediaFile);
  media.mediaFile.setPlaying(true);
  assert.deepEqual(updates, [true], "@update:playing follows notify::playing");
  media.mediaFile.setPlaying(false);
  assert.equal(controls.widget, widget);
  app.unmount();
  source.unmount();
});

const gstPlugin = (name) => {
  const result = spawnSync("gst-inspect-1.0", [name], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0;
};
const requiredGstPlugins = ["wavparse", "autoaudiosink"];
const optionalGstPlugins = ["scaletempo"];

await test("media playback proves playing/timestamp when GStreamer plugins exist and reports the exact gap when they do not", () => {
  const missing = requiredGstPlugins.filter((name) => !gstPlugin(name));
  const missingOptional = optionalGstPlugins.filter((name) => !gstPlugin(name));
  if (missing.length)
    console.log(
      `[media] GStreamer playback is unavailable; missing plugins: ${missing.join(", ")}` +
        (missingOptional.length ? ` (optional missing: ${missingOptional.join(", ")})` : ""),
    );
  else
    console.log(
      `[media] GStreamer playback prerequisites present: ${requiredGstPlugins.join(", ")}` +
        (missingOptional.length ? ` (optional missing: ${missingOptional.join(", ")})` : ""),
    );

  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gio from "gi:Gio-2.0";
    import GLib from "gi:GLib-2.0";
    import { writeFileSync } from "node:fs";
    import { createApp, h, VBox, VMediaFile, VVideo } from "@zede/vio";
    try {
      const Gst = (await import("gi:Gst-1.0")).default;
      Gst.init([]);
    } catch {}
    Gtk.init();
    const tonePath = "/tmp/vio-media-playback.wav";
    {
      const sampleRate = 8000;
      const length = Math.round(sampleRate * 1.5);
      const data = Buffer.alloc(length * 2);
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + data.length, 4);
      header.write("WAVE", 8);
      header.write("fmt ", 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write("data", 36);
      header.writeUInt32LE(data.length, 40);
      writeFileSync(tonePath, Buffer.concat([header, data]));
    }
    const pump = (iterations = 40) => {
      for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
    };
    let media;
    let video;
    const errors = [];
    const playingUpdates = [];
    const videoErrors = [];
    const app = createApp({
      setup: () => () => h(VBox, null, {
        default: () => [
          h(VMediaFile, {
            ref: (value) => (media = value),
            filename: tonePath,
            onError: (error) => errors.push(error?.message ?? String(error)),
            "onUpdate:playing": (value) => playingUpdates.push(value),
          }),
          h(VVideo, {
            ref: (value) => (video = value),
            filename: tonePath,
            autoplay: true,
            onError: (error) => videoErrors.push(error?.message ?? String(error)),
          }),
        ],
      }),
    });
    app.mount();
    media.play();
    let maxTimestamp = 0;
    let sawPlaying = false;
    let sawEnded = false;
    const end = Date.now() + 1800;
    while (Date.now() < end) {
      pump();
      maxTimestamp = Math.max(maxTimestamp, Number(media.timestamp ?? 0));
      sawPlaying ||= Boolean(media.playing);
      sawEnded ||= Boolean(media.ended);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    media.pause();
    const report = {
      available: media.available,
      mediaFile: media.mediaFile?.constructor?.name ?? null,
      playing: Boolean(media.playing),
      sawPlaying,
      sawEnded,
      maxTimestamp,
      duration: Number(media.duration ?? 0),
      error: media.error,
      errors,
      playingUpdates,
      videoPlaying: Boolean(video.playing),
      videoError: video.error,
      videoErrors,
    };
    console.log(JSON.stringify(report));
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
  assert.equal(report.available, true, "an existing file creates a media stream");

  if (missing.length === 0) {
    assert.equal(report.sawPlaying, true, "playback reaches playing");
    assert.ok(report.maxTimestamp > 0, `timestamp advances: ${report.maxTimestamp}`);
    assert.ok(
      report.duration > 0 || report.sawEnded,
      `duration or end is reported: ${report.duration}`,
    );
    assert.equal(report.error, null);
  } else {
    assert.equal(report.error != null, true, "the stream reports the missing-plugin error");
    assert.equal(report.playing, false, "playback never starts without the plugins");
    assert.equal(report.maxTimestamp, 0, "no timestamp advance without decoders and a sink");
    assert.match(report.error, /missing a plug-in|not available|No suitable plugins/i);
    assert.equal(report.videoError != null, true, "VVideo surfaces the same stream error");
    console.log(`[media] Gtk.MediaFile error: ${report.error.split("\n")[0]}`);
  }
});

await test("VDrawingArea draws with Cairo in a presented window", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, VDrawingArea, VWindow } from "@zede/vio";
    Gtk.init();
    const calls = [];
    const errors = [];
    let failed = false;
    const app = createApp({
      setup: () => () =>
        h(VWindow, { title: "draw", defaultWidth: 240, defaultHeight: 160, visible: true }, {
          default: () =>
            h("box", { orientation: 1 }, {
              default: () => [
                h(VDrawingArea, {
                  contentWidth: 120,
                  contentHeight: 80,
                  draw: (area, cr, width, height) => {
                    calls.push([area.constructor.name, width, height]);
                    cr.setSourceRgb(0.2, 0.6, 0.3);
                    cr.rectangle(0, 0, width, height);
                    cr.fill();
                  },
                }),
                h(VDrawingArea, {
                  contentWidth: 40,
                  contentHeight: 40,
                  onDraw: () => calls.push(["attr", 0, 0]),
                }),
                h(VDrawingArea, {
                  contentWidth: 20,
                  contentHeight: 20,
                  draw: () => {
                    if (failed) return;
                    failed = true;
                    throw new Error("draw exploded");
                  },
                  onError: (error) => errors.push(error.message),
                }),
              ],
            }),
        }),
    });
    app.mount();
    const end = Date.now() + 500;
    while (Date.now() < end) {
      for (let index = 0; index < 40; index++) GLib.MainContext.default().iteration(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    console.log(JSON.stringify({ calls: calls.length, first: calls[0], errors: errors.length }));
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
  const report = JSON.parse(result.stdout.trim());
  assert.ok(report.calls >= 2, `draw callbacks ran: ${JSON.stringify(report)}`);
  assert.equal(report.first[0], "GtkDrawingArea");
  assert.ok(report.first[1] > 0 && report.first[2] > 0, "the drawing area is allocated");
  assert.equal(report.errors, 1, "a throwing draw handler is reported instead of aborting");
  assert.doesNotMatch(result.stderr, /Gtk-CRITICAL|GLib-CRITICAL|Gdk-CRITICAL/);
});

await test("VGLArea maps render properties and reports its context without a window", async () => {
  let handle;
  const app = mount(() =>
    h(VGLArea, {
      ref: (value) => (handle = value),
      hasDepthBuffer: true,
      hasStencilBuffer: false,
      useEs: true,
      autoRender: false,
    }),
  );
  await nextTick();
  const area = widgetOf(app);
  assert.ok(area instanceof Gtk.GLArea);
  assert.equal(area.getHasDepthBuffer(), true);
  assert.equal(area.getHasStencilBuffer(), false);
  assert.equal(area.getUseEs(), true);
  assert.equal(area.getAutoRender(), false);
  assert.equal(handle.widget, area);
  assert.equal(handle.context, null, "no context exists before realization");
  assert.equal(typeof handle.api, "number", "Gtk.GLArea reports its API enum before realization");
  app.unmount();
});

await test("gi:GL-1.0 exports no OpenGL entry points and Gdk.GLContext is lifecycle-only", () => {
  // Verified on node-gtk 4.1.1: the typelib carries GL type names plus glInitNames only.
  assert.deepEqual(Object.keys(GL).sort(), [
    "bitfield",
    "boolean",
    "charARB",
    "clampf",
    "enum",
    "float",
    "handleARB",
    "initNames",
    "int",
    "intptr",
    "sizei",
    "sizeiptr",
    "uint",
    "void",
  ]);
  for (const name of ["glClear", "glBegin", "glCreateShader", "glViewport", "glGetString"])
    assert.equal(typeof GL[name], "undefined", `${name} is not callable from JavaScript`);
  for (const name of ["makeCurrent", "getVersion", "getRequiredVersion", "isLegacy", "getApi"])
    assert.equal(typeof Gdk.GLContext.prototype[name], "function", `Gdk.GLContext has ${name}()`);
  for (const name of ["getDepth", "getStencil", "getProcAddress", "glClear"])
    assert.equal(
      typeof Gdk.GLContext.prototype[name],
      "undefined",
      `Gdk.GLContext has no ${name}()`,
    );
  assert.equal(typeof Gdk.GLContext.clearCurrent, "function");
  assert.equal(typeof Gdk.GLContext.getCurrent, "function");
  // GstGL-1.0 also has no callable GL commands. It is not imported here because loading the
  // typelib logs three GLib-CRITICAL assertions before any vio code runs (see docs/limitations.md).
});

await test("VGLArea receives a real frame with a live context in a child process", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import GLib from "gi:GLib-2.0";
    import Cairo from "gi:cairo";
    import { statSync } from "node:fs";
    import { createApp, h, VGLArea, VWindow } from "@zede/vio";
    Gtk.init();
    let handle;
    let frames = 0;
    let contextType = null;
    let madeCurrent = false;
    let cairoBytes = 0;
    const errors = [];
    const app = createApp({
      setup: () => () => h(VWindow, {
        title: "gl frame",
        defaultWidth: 320,
        defaultHeight: 240,
        visible: true,
      }, {
        default: () => h(VGLArea, {
          ref: (value) => (handle = value),
          hasDepthBuffer: true,
          autoRender: true,
          onRender: (context) => {
            frames++;
            if (!context) {
              errors.push("render without a context");
              return false;
            }
            contextType = context.constructor.name;
            try {
              context.makeCurrent();
              madeCurrent = true;
            } catch (error) {
              errors.push(error?.message ?? String(error));
            }
            if (cairoBytes === 0) {
              // node-gtk exposes no OpenGL command bindings, so the callback draws with Cairo and
              // returns false: GTK then clears the GL framebuffer through its own renderer.
              const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 8, 8);
              const cr = new Cairo.Context(surface);
              cr.setSourceRgb(0.2, 0.6, 0.3);
              cr.rectangle(0, 0, 8, 8);
              cr.fill();
              surface.flush();
              surface.writeToPng("/tmp/vio-gl-frame.png");
              cairoBytes = statSync("/tmp/vio-gl-frame.png").size;
            }
            return false;
          },
        }),
      }),
    });
    app.mount();
    const end = Date.now() + 2000;
    while (Date.now() < end && frames === 0) {
      for (let index = 0; index < 40; index++) GLib.MainContext.default().iteration(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (let index = 0; index < 40; index++) GLib.MainContext.default().iteration(false);
    console.log(JSON.stringify({
      frames,
      contextType,
      handleContext: handle?.context?.constructor?.name ?? null,
      api: handle?.api,
      error: handle?.widget?.getError()?.message ?? null,
      madeCurrent,
      cairoBytes,
      errors,
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
  assert.ok(report.frames >= 1, `the render signal fired: ${JSON.stringify(report)}`);
  assert.ok(report.contextType, "the frame carries a native GL context");
  assert.equal(report.handleContext, report.contextType);
  assert.equal(typeof report.api, "number", "the context reports its GL API");
  assert.equal(report.error, null, "Gtk.GLArea reports no error");
  assert.equal(report.madeCurrent, true, "the context can be made current");
  assert.ok(report.cairoBytes > 0, "the render callback performed real Cairo drawing");
  assert.deepEqual(report.errors, []);
  console.log(`[media] GL frame: ${report.contextType}, api=${report.api}`);
});

await test("VColorButton maps rgba strings/objects and emits color-set", async () => {
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VColorButton, {
      ref: (value) => (handle = value),
      rgba: "#3366cc",
      useAlpha: true,
      title: "Accent",
      "onUpdate:rgba": (value) => updates.push(value),
    }),
  );
  await nextTick();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.ColorButton);
  assert.ok(Math.abs(button.getRgba().red - 0.2) < 0.01);
  assert.equal(button.getUseAlpha(), true);
  assert.equal(button.getTitle(), "Accent");
  button.setRgba(
    (() => {
      const value = new Gdk.RGBA();
      value.parse("#ff0000");
      return value;
    })(),
  );
  button.emit("color-set");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].toString(), "rgb(255,0,0)");
  assert.equal(handle.rgba.red, 1);
  app.unmount();

  const updated = mount(() =>
    h(VColorButton, { ref: (value) => (handle = value), rgba: "#00ff00" }),
  );
  await nextTick();
  assert.equal(widgetOf(updated).getRgba().green, 1);
  updated.unmount();

  assert.throws(
    () => withoutWarnings(() => mount(() => h(VColorButton, { rgba: "not-a-color" }))),
    /invalid rgba/,
  );
});

await test("VFontButton maps font strings and descriptions and emits font-set", async () => {
  const updates = [];
  let handle;
  const app = mount(() =>
    h(VFontButton, {
      ref: (value) => (handle = value),
      font: "Sans 12",
      useFont: true,
      useSize: false,
      title: "Body",
      "onUpdate:font": (value) => updates.push(value),
    }),
  );
  await nextTick();
  const button = widgetOf(app);
  assert.ok(button instanceof Gtk.FontButton);
  assert.equal(button.getFont(), "Sans 12");
  assert.equal(button.getUseFont(), true);
  assert.equal(button.getUseSize(), false);
  assert.equal(button.getTitle(), "Body");
  button.setFont("Serif Bold 14");
  button.emit("font-set");
  assert.deepEqual(updates, ["Serif Bold 14"]);
  assert.equal(handle.font, "Serif Bold 14");
  app.unmount();

  const described = mount(() =>
    h(VFontButton, {
      ref: (value) => (handle = value),
      font: Pango.FontDescription.fromString("Monospace 10"),
    }),
  );
  await nextTick();
  assert.equal(widgetOf(described).getFont(), "Monospace 10");
  described.unmount();
});

await test("VColorDialogButton and VFontDialogButton sync native values", async () => {
  const colorUpdates = [];
  const fontUpdates = [];
  const colorSets = [];
  let color;
  let font;
  const app = mount(() => [
    h(VColorDialogButton, {
      ref: (value) => (color = value),
      rgba: "#3366cc",
      "onUpdate:rgba": (value) => colorUpdates.push(value),
      onColorSet: () => colorSets.push(true),
    }),
    h(VFontDialogButton, {
      ref: (value) => (font = value),
      font: "Sans 12",
      "onUpdate:font": (value) => fontUpdates.push(value),
      onFontSet: () => colorSets.push("font"),
    }),
  ]);
  await nextTick();
  const colorButton = color.widget;
  const fontButton = font.widget;
  assert.ok(colorButton instanceof Gtk.ColorDialogButton);
  assert.ok(fontButton instanceof Gtk.FontDialogButton);
  assert.equal(colorButton.getRgba().toString(), "rgb(51,102,204)");
  assert.equal(fontButton.getFontDesc().toString(), "Sans 12");
  const red = new Gdk.RGBA();
  red.parse("#ff0000");
  colorButton.setRgba(red);
  colorButton.notify("rgba");
  fontButton.setFontDesc(Pango.FontDescription.fromString("Serif 16"));
  fontButton.notify("font-desc");
  assert.equal(colorUpdates.at(-1)?.toString(), "rgb(255,0,0)");
  assert.equal(fontUpdates.at(-1), "Serif 16");
  assert.equal(colorSets.filter((item) => item === true).length, 1);
  assert.equal(colorSets.filter((item) => item === "font").length, 1);
  assert.equal(color.widget, colorButton);
  assert.equal(font.widget, fontButton);
  app.unmount();
});

await test("VCalendar maps date, exposes day/month/year and forwards signals", async () => {
  const updates = [];
  const events = [];
  let handle;
  const app = mount(() =>
    h(VCalendar, {
      ref: (value) => (handle = value),
      date: "2024-03-15",
      showDayNames: true,
      showHeading: false,
      showWeekNumbers: true,
      "onUpdate:date": (value) => updates.push(value),
      onDaySelected: () => events.push("day"),
      onNextMonth: () => events.push("next"),
      onPrevMonth: () => events.push("prev"),
    }),
  );
  await nextTick();
  const calendar = widgetOf(app);
  assert.ok(calendar instanceof Gtk.Calendar);
  assert.equal(calendar.getYear(), 2024);
  assert.equal(calendar.getMonth(), 2);
  assert.equal(calendar.getDay(), 15);
  assert.equal(calendar.getShowDayNames(), true);
  assert.equal(calendar.getShowHeading(), false);
  assert.equal(calendar.getShowWeekNumbers(), true);
  assert.equal(handle.day, 15);
  assert.equal(handle.month, 3);
  assert.equal(handle.year, 2024);
  calendar.emit("day-selected");
  calendar.emit("next-month");
  calendar.emit("prev-month");
  assert.ok(events.includes("day"));
  assert.ok(events.includes("next"));
  assert.ok(events.includes("prev"));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].format("%Y-%m-%d"), "2024-03-15");
  app.unmount();

  const changed = mount(() =>
    h(VCalendar, { ref: (value) => (handle = value), date: { year: 2025, month: 12, day: 31 } }),
  );
  await nextTick();
  assert.equal(widgetOf(changed).getYear(), 2025);
  assert.equal(widgetOf(changed).getMonth(), 11);
  assert.equal(widgetOf(changed).getDay(), 31);
  changed.unmount();
});

await test("toStringList and VStringList keep a Gtk.StringList in sync", async () => {
  assert.equal(toStringList(["one", "two"]).getNItems(), 2);
  const items = ref(["a", "b"]);
  let handle;
  const app = mount(() => h(VStringList, { ref: (value) => (handle = value), items: items.value }));
  await nextTick();
  const list = handle.stringList;
  assert.ok(list instanceof Gtk.StringList);
  assert.equal(list.getNItems(), 2);
  assert.equal(list.getString(1), "b");
  items.value = ["x", "y", "z"];
  await settle();
  assert.equal(list.getNItems(), 3);
  assert.equal(list.getString(2), "z");
  app.unmount();
});

await test("VFilterListModel filters reactively and reports its Gtk.Filter", async () => {
  const store = stringStore(["gamma", "alpha", "beta"]);
  const predicate = ref((item) => item.getString().startsWith("a") || item.getString() === "beta");
  let handle;
  const app = mount(() =>
    h(VFilterListModel, {
      ref: (value) => (handle = value),
      model: store,
      predicate: predicate.value,
      autoexpand: true,
    }),
  );
  await settle();
  assert.ok(handle.filterListModel instanceof Gtk.FilterListModel);
  assert.ok(handle.filter instanceof Gtk.CustomFilter);
  const names = () => {
    const result = [];
    for (let index = 0; index < handle.filterListModel.getNItems(); index++)
      result.push(handle.filterListModel.getItem(index).getString());
    return result;
  };
  assert.deepEqual(names(), ["alpha", "beta"]);
  predicate.value = (item) => item.getString().startsWith("g") || item.getString() === "beta";
  await settle();
  assert.deepEqual(names(), ["gamma", "beta"]);
  app.unmount();
});

await test(
  "VSortListModel sorts with a JS comparator and resorts on change",
  { skip: requiresGtk(4, 24) },
  async () => {
    const store = stringStore(["gamma", "alpha", "beta"]);
    const compare = ref((a, b) => a.getString().localeCompare(b.getString()));
    let handle;
    const app = mount(() =>
      h(VSortListModel, {
        ref: (value) => (handle = value),
        model: store,
        compare: compare.value,
      }),
    );
    await settle();
    assert.ok(handle.sortListModel instanceof Gtk.SortListModel);
    assert.ok(handle.sorter instanceof Gtk.Sorter);
    assert.equal(handle.sorter instanceof Gtk.CustomSorter, false);
    const names = () => {
      const result = [];
      for (let index = 0; index < handle.sortListModel.getNItems(); index++)
        result.push(handle.sortListModel.getItem(index).getString());
      return result;
    };
    assert.deepEqual(names(), ["alpha", "beta", "gamma"]);
    compare.value = (a, b) => b.getString().localeCompare(a.getString());
    await settle();
    assert.deepEqual(names(), ["gamma", "beta", "alpha"]);
    app.unmount();
  },
);

await test("selection helpers expose selected positions for the collection views", async () => {
  const store = stringStore(["a", "b", "c"]);
  let single;
  const singleApp = mountSetup(() => {
    single = useSingleSelection(store);
  });
  assert.equal(single.selected.value, -1, "the helper starts unselected");
  single.setSelected(1);
  assert.equal(single.selected.value, 1);
  assert.equal(single.selectedItem.value.getString(), "b");
  single.selection.setSelected(2);
  assert.equal(single.selected.value, 2, "native selection changes flow back");
  singleApp.unmount();

  let multi;
  const multiApp = mountSetup(() => {
    multi = useMultiSelection(store);
  });
  multi.select(0);
  multi.select(2);
  assert.deepEqual(multi.selected.value, [0, 2]);
  assert.equal(multi.selectedItems.value.length, 2);
  multi.unselect(0);
  assert.deepEqual(multi.selected.value, [2]);
  multi.selectAll();
  assert.deepEqual(multi.selected.value, [0, 1, 2]);
  multi.unselectAll();
  assert.deepEqual(multi.selected.value, []);
  multiApp.unmount();

  let none;
  const noneApp = mountSetup(() => {
    none = useNoSelection(store);
  });
  assert.ok(none.selection instanceof Gtk.NoSelection);
  assert.equal(none.selected.value, -1);
  noneApp.unmount();
});

await test("wave 4 components mount and unmount without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import {
      createApp, h, VBox, VLabel,
      VPicture, VMediaFile, VVideo, VMediaControls, VDrawingArea, VGLArea,
      VColorButton, VFontButton, VColorDialogButton, VFontDialogButton, VCalendar,
      VStringList, VFilterListModel, VSortListModel, getWidgetTypes,
    } from "@zede/vio";
    Gtk.init();
    const app = createApp({
      setup: () => () => h(VBox, null, {
        default: () => [
          h(VPicture, { filename: "/tmp/vio-media-missing.png" }),
          h(VMediaFile, { filename: "/tmp/vio-media-missing.wav" }),
          h(VVideo, { filename: "/tmp/vio-media-missing.mp4" }),
          h(VMediaControls, null),
          h(VDrawingArea, { contentWidth: 20, contentHeight: 20, draw: () => {} }),
          h(VGLArea, { hasDepthBuffer: true, autoRender: false }),
          h(VColorButton, { rgba: "#112233" }),
          h(VFontButton, { font: "Sans 10" }),
          h(VColorDialogButton, { rgba: "#445566" }),
          h(VFontDialogButton, { font: "Sans 11" }),
          h(VCalendar, { date: "2024-02-29" }),
          h(VStringList, { items: ["a", "b"] }),
          h(VFilterListModel, { model: null, predicate: () => true }),
          // The JS sorter needs GTK 4.24+ (node-gtk crashes in compare on 4.22).
          ...(Gtk.getMinorVersion() >= 24
            ? [h(VSortListModel, { model: null, compare: (a, b) => 0 })]
            : []),
          h(VLabel, null, { default: () => "media" }),
        ],
      }),
    });
    app.mount();
    const types = getWidgetTypes();
    app.unmount();
    console.log(JSON.stringify({ explicit: types.length, media: types.filter((type) => type.includes("media")).length }));
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
  JSON.parse(result.stdout.trim());
});
