import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import Gdk from "gi:Gdk-4.0";
import Pango from "gi:Pango-1.0";
import GLib from "gi:GLib-2.0";
import {
  VAboutDialog,
  VAlertDialog,
  VApplicationWindow,
  VAppChooserDialog,
  VAssistant,
  VAssistantPage,
  VBox,
  VColorChooserDialog,
  VColorDialog,
  VDialog,
  VFileChooserDialog,
  VFileChooserNative,
  VFileDialog,
  VFontChooserDialog,
  VFontDialog,
  VLabel,
  VMessageDialog,
  VPageSetupUnixDialog,
  VPrintUnixDialog,
  VWindow,
  createApp,
  getWidgetTypes,
  h,
  nextTick,
  ref,
  shallowRef,
} from "@zede/vio";

Gtk.init();
writeFileSync("/tmp/vio-dialogs-appchooser.txt", "hello");

const pump = (iterations = 200) => {
  for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  pump();
};
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
  const app = createApp({ setup: () => render });
  app.mount();
  return app;
};
const widgetOf = (app) => app.root.children[0].widget;
const toplevels = () => Gtk.Window.listToplevels();
const liveDialogs = () => toplevels().filter((window) => window instanceof Gtk.Dialog);
const filterNames = (model) => {
  const count = model?.getNItems?.() ?? 0;
  const names = [];
  for (let index = 0; index < count; index++) names.push(model.getItem(index)?.getName?.());
  return names;
};

await test("VWindow maps properties, cancels close-request and destroys on unmount", async () => {
  const cancelClose = ref(true);
  const events = [];
  let handle;
  const app = mount(() =>
    h(
      VWindow,
      {
        ref: (value) => (handle = value),
        title: "wave 3",
        defaultWidth: 360,
        defaultHeight: 220,
        modal: false,
        resizable: false,
        decorated: true,
        visible: true,
        onCloseRequest: () => (cancelClose.value ? false : undefined),
        onDestroy: () => {
          events.push("destroy");
        },
      },
      {
        default: () => h(VBox, null, { default: () => h(VLabel, null, { default: () => "body" }) }),
      },
    ),
  );
  const window = widgetOf(app);
  await settle();
  assert.ok(window instanceof Gtk.Window);
  assert.equal(window.getTitle(), "wave 3");
  assert.equal(window.getProperty("default-width"), 360);
  assert.equal(window.getProperty("default-height"), 220);
  assert.equal(window.getResizable(), false);
  assert.equal(window.getVisible(), true);
  assert.deepEqual(labelsIn(window.getChild()), ["body"]);

  assert.equal(window.emit("close-request"), true, "false is treated as cancel");
  window.close();
  pump();
  assert.equal(window.getVisible(), true, "a cancelling close-request keeps the window mapped");

  cancelClose.value = false;
  await nextTick();
  window.close();
  pump();
  assert.equal(window.getVisible(), false, "returning nothing lets GTK close the window");

  handle.destroy();
  assert.deepEqual(events, ["destroy"], "the exposed destroy() emits @destroy");
  app.unmount();
  assert.deepEqual(events, ["destroy", "destroy"], "@destroy is also emitted on unmount");
  assert.equal(app.root.children.length, 0);
  assert.equal(toplevels().includes(window), false, "unmount removes the window from GTK");
});

await test("VApplicationWindow registers, reuses and stops the application cleanly", async () => {
  const events = [];
  let first;
  const app = mount(() =>
    h(
      VApplicationWindow,
      {
        ref: (value) => (first = value),
        applicationId: "test.vio.dialogs.application",
        title: "app",
        visible: false,
        onActivate: () => {
          events.push("activate");
        },
        onQuit: () => {
          events.push("quit");
        },
      },
      { default: () => h(VLabel, null, { default: () => "app body" }) },
    ),
  );
  const window = widgetOf(app);
  const application = first.application;
  assert.ok(application instanceof Gtk.Application);
  assert.equal(application.getIsRegistered(), true);
  assert.equal(window.getApplication(), application);
  assert.equal(application.getWindows().length, 1);

  first.activate();
  pump();
  assert.deepEqual(events, ["activate"]);
  first.quit();
  assert.deepEqual(events, ["activate", "quit"]);

  let second;
  const secondApp = mount(() =>
    h(VApplicationWindow, {
      ref: (value) => (second = value),
      applicationId: "test.vio.dialogs.application",
      visible: false,
    }),
  );
  assert.equal(second.application, application, "the same application id is reused");
  assert.equal(application.getWindows().length, 2);

  secondApp.unmount();
  app.unmount();
  assert.equal(application.getWindows().length, 0);
  assert.equal(window.getApplication(), null);
  assert.equal(app.root.children.length, 0);
  assert.equal(secondApp.root.children.length, 0);
});

await test("VAssistant pages, page metadata, current-page model and signals", async () => {
  const showSecond = ref(true);
  const currentPage = ref(0);
  const prepared = [];
  const applied = [];
  const closed = [];
  const app = mount(() =>
    h(
      VAssistant,
      {
        currentPage: currentPage.value,
        "onUpdate:currentPage": (value) => (currentPage.value = value),
        onPrepare: (page) => {
          prepared.push(page);
        },
        onApply: (page) => {
          applied.push(page);
        },
        onClose: (page) => {
          closed.push(page);
        },
      },
      {
        default: () => [
          h(
            VAssistantPage,
            { key: "first", title: "First", pageType: "intro", complete: true },
            { default: () => h(VLabel, null, { default: () => "one" }) },
          ),
          showSecond.value
            ? h(
                VAssistantPage,
                { key: "second", title: "Second", pageType: "confirm" },
                { default: () => h(VLabel, null, { default: () => "two" }) },
              )
            : null,
        ],
      },
    ),
  );
  const assistant = widgetOf(app);
  assert.ok(assistant instanceof Gtk.Assistant);
  assert.equal(assistant.getNPages(), 2);
  assert.equal(assistant.getPageTitle(assistant.getNthPage(0)), "First");
  assert.equal(assistant.getPageTitle(assistant.getNthPage(1)), "Second");
  assert.equal(assistant.getPageType(assistant.getNthPage(0)), Gtk.AssistantPageType.INTRO);
  assert.equal(assistant.getPageType(assistant.getNthPage(1)), Gtk.AssistantPageType.CONFIRM);
  assert.equal(assistant.getPageComplete(assistant.getNthPage(0)), true);
  assert.equal(assistant.getCurrentPage(), 0);

  currentPage.value = 1;
  await nextTick();
  assert.equal(assistant.getCurrentPage(), 1, "the prop calls setCurrentPage()");

  assistant.setCurrentPage(0);
  await nextTick();
  assert.equal(currentPage.value, 0, "::prepare updates v-model:current-page");

  const second = assistant.getNthPage(1);
  assistant.emit("apply", second);
  assistant.emit("close", second);
  assert.equal(applied.length, 1);
  assert.equal(closed.length, 1);
  assert.ok(prepared.length >= 2);

  showSecond.value = false;
  await nextTick();
  assert.equal(assistant.getNPages(), 1, "the removed page leaves the assistant");
  assert.equal(assistant.getNthPage(1), null);
  app.unmount();
});

await test("VDialog puts #content in the content area and maps declarative buttons", async () => {
  const visible = ref(false);
  const responses = [];
  let handle;
  const app = mount(() =>
    h(
      VDialog,
      {
        ref: (value) => (handle = value),
        title: "dialog",
        visible: visible.value,
        buttons: [
          { id: "ok", label: "OK", default: true, suggested: true },
          { id: 2, label: "Cancel" },
        ],
        defaultResponse: "ok",
        onResponse: (id) => {
          responses.push(id);
        },
        "onUpdate:visible": (value) => {
          visible.value = value;
        },
      },
      {
        content: () => h(VLabel, null, { default: () => "dialog content" }),
      },
    ),
  );
  const dialog = widgetOf(app);
  assert.ok(dialog instanceof Gtk.Dialog);
  assert.deepEqual(labelsIn(dialog.getContentArea()), ["dialog content"]);
  assert.deepEqual([...handle.buttons.keys()], ["ok", 2]);
  assert.equal(handle.button("ok").getLabel(), "OK");
  assert.equal(handle.button("ok").hasCssClass("default"), true);
  assert.equal(handle.button("ok").hasCssClass("suggested-action"), true);
  assert.equal(dialog.getWidgetForResponse(handle.buttons.get("ok").code), handle.button("ok"));

  dialog.emit("response", handle.buttons.get("ok").code);
  assert.deepEqual(responses, ["ok"], "a string button id comes back unchanged");
  assert.equal(visible.value, false);
  assert.equal(dialog.getVisible(), false);

  app.unmount();
  assert.equal(toplevels().includes(dialog), false);
  assert.equal(app.root.children.length, 0);
});

await test("VMessageDialog maps message-type, text and stock buttons", async () => {
  const responses = [];
  const closeResponses = [];
  const app = mount(() =>
    h(VMessageDialog, {
      messageType: "warning",
      buttons: "ok-cancel",
      text: "Question",
      secondaryText: "Details",
      visible: false,
      onResponse: (id) => {
        responses.push(id);
      },
      onCloseResponse: (id) => {
        closeResponses.push(id);
      },
    }),
  );
  const dialog = widgetOf(app);
  assert.ok(dialog instanceof Gtk.MessageDialog);
  assert.equal(dialog.getProperty("message-type"), Gtk.MessageType.WARNING);
  assert.equal(dialog.getProperty("text"), "Question");
  assert.equal(dialog.getProperty("secondary-text"), "Details");
  assert.equal(dialog.getWidgetForResponse(Gtk.ResponseType.OK)?.getLabel(), "OK");
  assert.equal(dialog.getWidgetForResponse(Gtk.ResponseType.CANCEL)?.getLabel(), "Cancel");
  assert.equal(dialog.getWidgetForResponse(Gtk.ResponseType.OK)?.hasCssClass("default"), true);

  dialog.emit("response", Gtk.ResponseType.OK);
  assert.deepEqual(responses, [Gtk.ResponseType.OK]);
  dialog.emit("response", Gtk.ResponseType.CLOSE);
  assert.deepEqual(closeResponses, [Gtk.ResponseType.CLOSE]);
  app.unmount();
  assert.equal(toplevels().includes(dialog), false);
});

await test("VFileChooserDialog maps action, filters, current-name and buttons", async () => {
  const filters = ref([{ name: "Text", mimeTypes: ["text/plain"], patterns: ["*.txt"] }]);
  const app = mount(() =>
    h(VFileChooserDialog, {
      title: "Save",
      action: "save",
      filters: filters.value,
      currentName: "untitled.txt",
      acceptLabel: "Save it",
      cancelLabel: "Back",
      visible: false,
    }),
  );
  const dialog = widgetOf(app);
  assert.ok(dialog instanceof Gtk.FileChooserDialog);
  assert.equal(dialog.getAction(), Gtk.FileChooserAction.SAVE);
  assert.equal(dialog.getCurrentName(), "untitled.txt");
  assert.equal(dialog.getWidgetForResponse(Gtk.ResponseType.ACCEPT)?.getLabel(), "Save it");
  assert.equal(dialog.getWidgetForResponse(Gtk.ResponseType.CANCEL)?.getLabel(), "Back");
  assert.equal(dialog.getFilter()?.getName(), "Text");
  assert.deepEqual(filterNames(dialog.getFilters()), ["Text"]);

  filters.value = [
    { name: "Images", mimeTypes: ["image/png"] },
    { name: "All", patterns: ["*"] },
  ];
  await nextTick();
  pump();
  assert.deepEqual(filterNames(dialog.getFilters()), ["Images", "All"]);

  app.unmount();
  assert.equal(toplevels().includes(dialog), false);

  const openApp = mount(() =>
    h(VFileChooserDialog, { title: "Open", action: "open", selectMultiple: true, visible: false }),
  );
  const open = widgetOf(openApp);
  assert.equal(open.getSelectMultiple(), true);
  openApp.unmount();
});

await test("VFileChooserNative is a null-rendering Gtk.NativeDialog controller", async () => {
  const responses = [];
  let handle;
  const app = mount(() =>
    h(VFileChooserNative, {
      ref: (value) => (handle = value),
      title: "Native",
      action: "open",
      acceptLabel: "Choose",
      filters: [{ name: "Text", mimeTypes: ["text/plain"] }],
      onResponse: (id) => {
        responses.push(id);
      },
    }),
  );
  assert.ok(handle.native instanceof Gtk.FileChooserNative);
  assert.equal(handle.native.getTitle(), "Native");
  assert.equal(handle.native.getAction(), Gtk.FileChooserAction.OPEN);
  assert.equal(handle.native.getAcceptLabel(), "Choose");
  assert.equal(handle.native.getFilter()?.getName(), "Text");
  assert.equal(handle.widget, handle.native, "the exposed handle is the native dialog");

  const native = handle.native;
  native.emit("response", Gtk.ResponseType.CANCEL);
  assert.deepEqual(responses, [Gtk.ResponseType.CANCEL]);
  app.unmount();
  assert.equal(native.getVisible(), false);
});

await test("VColorChooserDialog and VFontChooserDialog map their chooser properties", async () => {
  const rgba = new Gdk.RGBA();
  rgba.red = 0.25;
  rgba.green = 0.5;
  rgba.blue = 0.75;
  rgba.alpha = 1;
  const colorApp = mount(() =>
    h(VColorChooserDialog, {
      title: "Color",
      rgba,
      acceptLabel: "Use",
      visible: false,
    }),
  );
  const color = widgetOf(colorApp);
  assert.ok(color instanceof Gtk.ColorChooserDialog);
  assert.equal(Math.round(color.getRgba().red * 100), 25);
  assert.equal(color.getWidgetForResponse(Gtk.ResponseType.OK)?.getLabel(), "Use");
  assert.equal(color.getWidgetForResponse(Gtk.ResponseType.CANCEL)?.getLabel(), "Cancel");
  colorApp.unmount();

  const fontDesc = shallowRef(Pango.FontDescription.fromString("Sans 12"));
  let notifications = 0;
  const fontApp = mount(() =>
    h(VFontChooserDialog, {
      title: "Font",
      fontDesc: fontDesc.value,
      previewText: "Preview",
      level: "style",
      visible: false,
    }),
  );
  const font = widgetOf(fontApp);
  assert.ok(font instanceof Gtk.FontChooserDialog);
  assert.equal(font.getPreviewText(), "Preview");
  assert.equal(font.getLevel(), Gtk.FontChooserLevel.STYLE);
  font.on("notify::font-desc", () => {
    notifications++;
  });
  fontDesc.value = Pango.FontDescription.fromString("Monospace 14");
  await nextTick();
  pump();
  assert.ok(notifications > 0, "a font-desc prop update calls setFontDesc()");
  fontApp.unmount();
});

await test("VAppChooserDialog, VPrintUnixDialog and VPageSetupUnixDialog expose native props", async () => {
  const file = Gio.File.newForPath("/tmp/vio-dialogs-appchooser.txt");
  const responses = [];
  let handle;
  const appChooserApp = mount(() =>
    h(VAppChooserDialog, {
      ref: (value) => (handle = value),
      title: "Open with",
      contentType: "text/plain",
      gfile: file,
      visible: false,
      onResponse: (id) => {
        responses.push(id);
      },
    }),
  );
  assert.ok(handle.dialog instanceof Gtk.AppChooserDialog);
  assert.equal(handle.dialog.getContentType(), "text/plain");
  assert.equal(handle.dialog.getProperty("gfile")?.getPath(), "/tmp/vio-dialogs-appchooser.txt");
  assert.ok(handle.dialog.getWidgetForResponse(Gtk.ResponseType.OK));
  handle.dialog.emit("response", Gtk.ResponseType.OK);
  assert.deepEqual(responses, [Gtk.ResponseType.OK]);
  appChooserApp.unmount();

  const pageSetup = new Gtk.PageSetup();
  const printSettings = new Gtk.PrintSettings();
  const printApp = mount(() =>
    h(VPrintUnixDialog, { title: "Print", pageSetup, printSettings, visible: false }),
  );
  const printPageSetup = widgetOf(printApp).getPageSetup();
  assert.ok(printPageSetup instanceof Gtk.PageSetup);
  assert.equal(
    printPageSetup.getPageWidth(Gtk.Unit.POINTS),
    pageSetup.getPageWidth(Gtk.Unit.POINTS),
  );
  printApp.unmount();

  const pageApp = mount(() =>
    h(VPageSetupUnixDialog, { title: "Page setup", pageSetup, visible: false }),
  );
  const dialogPageSetup = widgetOf(pageApp).getPageSetup();
  assert.ok(dialogPageSetup instanceof Gtk.PageSetup);
  assert.equal(
    dialogPageSetup.getPageWidth(Gtk.Unit.POINTS),
    pageSetup.getPageWidth(Gtk.Unit.POINTS),
  );
  pageApp.unmount();
});

await test("VAboutDialog maps text, arrays, license, logo and activate-link", async () => {
  const links = [];
  const app = mount(() =>
    h(VAboutDialog, {
      authors: ["Ada Lovelace", "Grace Hopper"],
      artists: ["An Artist"],
      documenters: ["A Documenter"],
      comments: "Wave 3",
      copyright: "(c) vio",
      licenseType: "mit-x11",
      version: "9.9.9",
      website: "https://example.test/vio",
      websiteLabel: "Project",
      logo: "dialog-information",
      programName: "vio",
      onActivateLink: (uri) => {
        links.push(uri);
      },
    }),
  );
  const about = widgetOf(app);
  assert.ok(about instanceof Gtk.AboutDialog);
  assert.deepEqual(about.getProperty("authors"), ["Ada Lovelace", "Grace Hopper"]);
  assert.deepEqual(about.getProperty("artists"), ["An Artist"]);
  assert.deepEqual(about.getProperty("documenters"), ["A Documenter"]);
  assert.equal(about.getProperty("comments"), "Wave 3");
  assert.equal(about.getProperty("copyright"), "(c) vio");
  assert.equal(about.getProperty("license-type"), Gtk.License.MIT_X11);
  assert.equal(about.getProperty("version"), "9.9.9");
  assert.equal(about.getProperty("website"), "https://example.test/vio");
  assert.equal(about.getProperty("website-label"), "Project");
  assert.equal(about.getProperty("logo-icon-name"), "dialog-information");
  assert.equal(about.getProperty("program-name"), "vio");
  about.emit("activate-link", "https://example.test/vio");
  assert.deepEqual(links, ["https://example.test/vio"]);
  app.unmount();
});

await test("VAlertDialog exposes its native properties and validates the parent", () => {
  const dead = new Gtk.Window();
  dead.destroy();
  let handle;
  const app = mount(() =>
    h(VAlertDialog, {
      ref: (value) => (handle = value),
      message: "Continue?",
      detail: "Wave 3",
      buttons: ["Cancel", "OK"],
      cancelButton: 0,
      defaultButton: 1,
      modal: true,
    }),
  );
  assert.equal(handle.dialog.getMessage(), "Continue?");
  assert.equal(handle.dialog.getDetail(), "Wave 3");
  assert.deepEqual(handle.dialog.getButtons(), ["Cancel", "OK"]);
  assert.equal(handle.dialog.getCancelButton(), 0);
  assert.equal(handle.dialog.getDefaultButton(), 1);
  assert.equal(handle.dialog.getModal(), true);
  assert.throws(
    () => handle.choose(null),
    /vio: VAlertDialog.choose\(\) requires a Gtk.Window parent/,
  );
  assert.throws(
    () => handle.choose(dead),
    /vio: VAlertDialog.choose\(\) parent window has been destroyed/,
  );
  app.unmount();
});

await test("async file, color and font dialogs cancel in isolated processes", () => {
  const cases = [
    {
      name: "VFileDialog",
      code: `const pending = handle.open(parent);`,
    },
    {
      name: "VColorDialog",
      code: `const pending = handle.chooseRgba(parent);`,
    },
    {
      name: "VFontDialog",
      code: `const pending = handle.chooseFont(parent);`,
    },
  ];
  for (const entry of cases) {
    const source = `
      import Gtk from "gi:Gtk-4.0";
      import { createApp, h, ${entry.name} } from "@zede/vio";
      Gtk.init();
      const parent = new Gtk.Window({ title: "parent" });
      let handle;
      const app = createApp({ setup: () => () => h(${entry.name}, { ref: (value) => (handle = value), title: "x" }) });
      app.mount();
      ${entry.code}
      if (!handle.pending) throw new Error("operation is not pending");
      if (!handle.cancel()) throw new Error("cancel() returned false");
      const result = await pending;
      if (result !== null) throw new Error("cancellation did not resolve null");
      if (handle.pending) throw new Error("pending was not cleared");
      app.unmount();
      parent.destroy();
      console.log("async-cancel-ok");
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
    assert.equal(result.status, 0, `${entry.name}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "async-cancel-ok", entry.name);
    assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/, entry.name);
  }
});

await test("VAlertDialog choose() resolves and cancels in an isolated process", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, VAlertDialog } from "@zede/vio";
    Gtk.init();
    const pump = (iterations = 200) => {
      for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
    };
    const parent = new Gtk.Window({ title: "alert parent" });
    parent.present();
    pump();
    await new Promise((resolve) => setTimeout(resolve, 20));
    pump();
    const events = [];
    let handle;
    const app = createApp({
      setup: () => () =>
        h(VAlertDialog, {
          ref: (value) => (handle = value),
          message: "Continue?",
          buttons: ["Cancel", "OK"],
          cancelButton: 0,
          defaultButton: 1,
          onResponse: (id) => {
            events.push(["response", id]);
          },
        }),
    });
    app.mount();
    const adopting = handle.choose(parent);
    await new Promise((resolve) => setTimeout(resolve, 50));
    pump();
    const dialog = Gtk.Window.listToplevels().find((window) => window instanceof Gtk.Dialog);
    if (!dialog) throw new Error("the alert did not present an internal Gtk.Dialog");
    dialog.getWidgetForResponse(1).emit("clicked");
    pump();
    if (await adopting !== 1) throw new Error("the response did not resolve to 1");
    if (handle.pending) throw new Error("pending was not cleared after a response");

    const cancelled = handle.choose(parent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    pump();
    if (!handle.cancel()) throw new Error("cancel() returned false");
    if (await cancelled !== null) throw new Error("cancellation did not resolve null");

    const pending = handle.choose(parent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    pump();
    let double = "";
    try {
      handle.choose(parent);
    } catch (error) {
      double = error.message;
    }
    if (!double.includes("already pending")) throw new Error("double choose was not rejected");
    app.unmount();
    if (await pending !== null) throw new Error("unmount did not cancel the pending alert");
    parent.destroy();
    console.log("alert-ok");
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
  assert.equal(result.stdout.trim(), "alert-ok");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});

await test("VFileDialog, VColorDialog and VFontDialog reject a missing or dead parent", async () => {
  let file;
  let color;
  let font;
  const app = mount(() => [
    h(VFileDialog, { ref: (value) => (file = value) }),
    h(VColorDialog, { ref: (value) => (color = value) }),
    h(VFontDialog, { ref: (value) => (font = value) }),
  ]);
  assert.throws(() => file.open(null), /vio: VFileDialog.open\(\) requires a Gtk.Window parent/);
  assert.throws(
    () => color.chooseRgba({}),
    /vio: VColorDialog.chooseRgba\(\) requires a Gtk.Window parent/,
  );
  assert.throws(
    () => font.chooseFont(null),
    /vio: VFontDialog.chooseFont\(\) requires a Gtk.Window parent/,
  );
  const dead = new Gtk.Window();
  dead.destroy();
  assert.throws(
    () => file.save(dead),
    /vio: VFileDialog.save\(\) parent window has been destroyed/,
  );
  app.unmount();
});

await test("wave 3 registrations are appended after the wave 1 and 2 widget types", () => {
  const before = [
    "window",
    "box",
    "label",
    "entry",
    "button",
    "image",
    "list-box",
    "list-box-row",
    "scrolled-window",
    "grid",
    "stack",
    "separator",
    "spinner",
    "switch",
    "check-button",
    "key-controller",
    "vio-notebook",
    "vio-paned",
    "vio-overlay",
    "vio-center-box",
    "vio-header-bar",
    "vio-flow-box",
    "vio-fixed",
    "list-view",
    "menu-button",
    "expander",
    "vio-search-bar",
    "vio-action-bar",
    "vio-info-bar",
    "vio-statusbar",
  ];
  const types = getWidgetTypes();
  assert.deepEqual(types.slice(0, before.length), before);
  for (const type of [
    "vio-application-window",
    "vio-assistant",
    "vio-dialog",
    "vio-message-dialog",
    "vio-file-chooser-dialog",
    "vio-color-chooser-dialog",
    "vio-font-chooser-dialog",
    "vio-print-unix-dialog",
    "vio-page-setup-unix-dialog",
    "vio-about-dialog",
  ])
    assert.ok(types.includes(type), `${type} is registered`);
  assert.ok(types.indexOf("vio-dialog") >= before.length);
});

await test("wave 3 components mount and unmount without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gio from "gi:Gio-2.0";
    import { writeFileSync } from "node:fs";
    import {
      createApp, h, VBox, VLabel,
      VAboutDialog, VAlertDialog, VApplicationWindow, VAppChooserDialog, VAssistant,
      VAssistantPage, VColorChooserDialog, VColorDialog, VDialog, VFileChooserDialog,
      VFileChooserNative, VFileDialog, VFontChooserDialog, VFontDialog, VMessageDialog,
      VPageSetupUnixDialog, VPrintUnixDialog, VWindow,
    } from "@zede/vio";
    Gtk.init();
    writeFileSync("/tmp/vio-dialogs-clean.txt", "hello");
    const file = Gio.File.newForPath("/tmp/vio-dialogs-clean.txt");
    const pageSetup = new Gtk.PageSetup();
    const printSettings = new Gtk.PrintSettings();
    const app = createApp({
      setup: () => () => [
        h(VWindow, { visible: false, title: "window" }, { default: () => h(VLabel, null, { default: () => "body" }) }),
        h(VApplicationWindow, { visible: false, applicationId: "test.vio.dialogs.clean", title: "app" }),
        h(VDialog, { title: "dialog", visible: false, buttons: [{ id: "ok", label: "OK" }] }),
        h(VMessageDialog, { messageType: "info", buttons: "ok", text: "message", visible: false }),
        h(VFileChooserDialog, { title: "file", action: "open", visible: false }),
        h(VFileChooserNative, { title: "native", action: "open" }),
        h(VColorChooserDialog, { title: "color", visible: false }),
        h(VFontChooserDialog, { title: "font", visible: false }),
        h(VAppChooserDialog, { title: "app chooser", contentType: "text/plain", gfile: file, visible: false }),
        h(VPrintUnixDialog, { title: "print", pageSetup, printSettings, visible: false }),
        h(VPageSetupUnixDialog, { title: "page", pageSetup, visible: false }),
        h(VAboutDialog, { authors: ["A"], version: "1" }),
        h(VAssistant, null, {
          default: () => h(VAssistantPage, { title: "page" }, { default: () => h(VLabel, null, { default: () => "assistant" }) }),
        }),
        h(VAlertDialog, { message: "alert", buttons: ["OK"] }),
        h(VFileDialog, null),
        h(VColorDialog, null),
        h(VFontDialog, null),
        h(VBox, null, { default: () => h(VLabel, null, { default: () => "root" }) }),
      ],
    });
    app.mount();
    app.unmount();
    console.log("dialogs-clean");
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
  assert.equal(result.stdout.trim(), "dialogs-clean");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});
