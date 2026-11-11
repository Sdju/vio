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
  VShortcutsGroup,
  VShortcutsSection,
  VShortcutsShortcut,
  VShortcutsWindow,
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
  assert.equal(second.getParent(), null, "the removed page is unparented from the internal stack");
  app.unmount();
});

await test("VAssistant unparents a removed page without GTK warnings", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import {
      VAssistant, VAssistantPage, VLabel, createApp, h, nextTick, ref,
    } from "@zede/vio";
    Gtk.init();
    const showSecond = ref(true);
    const app = createApp({
      setup: () => () => h(VAssistant, null, {
        default: () => [
          h(VAssistantPage, { key: "first", title: "First" }, { default: () => h(VLabel, null, { default: () => "one" }) }),
          showSecond.value
            ? h(VAssistantPage, { key: "second", title: "Second" }, { default: () => h(VLabel, null, { default: () => "two" }) })
            : null,
        ],
      }),
    });
    app.mount();
    const assistant = app.root.children[0].widget;
    const removed = assistant.getNthPage(1);
    showSecond.value = false;
    await nextTick();
    const parent = removed.getParent();
    console.log(JSON.stringify({ pages: assistant.getNPages(), parent: parent ? parent.constructor.name : null }));
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
  assert.deepEqual(JSON.parse(result.stdout.trim()), { pages: 1, parent: null });
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
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
      // Returning true stops the signal before Gtk.AboutDialog's default handler
      // launches the URI: headless CI has no OpenURI portal and GTK 4.14 crashes
      // while falling back to GAppInfo there.
      onActivateLink: (uri) => {
        links.push(uri);
        return true;
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

await test("VColorDialog accepts a colour and still cancels a second request", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Gdk from "gi:Gdk-4.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, installCss, VColorDialog } from "@zede/vio";
    Gtk.init();
    installCss("slider { min-width: 16px; min-height: 16px; }");
    const pump = (iterations = 200) => {
      for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
    };
    const parent = new Gtk.Window({ title: "colour parent" });
    parent.present();
    pump();
    await new Promise((resolve) => setTimeout(resolve, 30));
    pump();
    const events = [];
    let handle;
    const app = createApp({
      setup: () => () =>
        h(VColorDialog, {
          ref: (value) => (handle = value),
          title: "pick",
          onColor: (color) => events.push(color),
        }),
    });
    app.mount();
    const choosing = handle.chooseRgba(parent);
    await new Promise((resolve) => setTimeout(resolve, 80));
    pump();
    const dialog = Gtk.Window.listToplevels().find((window) => window instanceof Gtk.Dialog);
    if (!dialog) throw new Error("the colour dialog did not present a Gtk.Dialog");
    const accept =
      dialog.getWidgetForResponse(Gtk.ResponseType.OK) ??
      dialog.getWidgetForResponse(Gtk.ResponseType.ACCEPT);
    if (!accept) throw new Error("the colour dialog has no accept button");
    accept.emit("clicked");
    pump();
    const result = await choosing;
    if (!(result instanceof Gdk.RGBA)) throw new Error("the colour result is not a Gdk.RGBA");
    if (events.length !== 1 || !(events[0] instanceof Gdk.RGBA))
      throw new Error("@color did not receive the accepted Gdk.RGBA");
    if (handle.pending) throw new Error("pending was not cleared after a colour response");

    const cancelled = handle.chooseRgba(parent);
    await new Promise((resolve) => setTimeout(resolve, 40));
    pump();
    if (!handle.cancel()) throw new Error("cancel() returned false");
    if (await cancelled !== null) throw new Error("cancellation did not resolve null");
    if (handle.pending) throw new Error("pending was not cleared after cancel()");
    app.unmount();
    parent.destroy();
    console.log("color-ok");
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
  assert.equal(result.stdout.trim(), "color-ok");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});

await test("VFontDialog preselects a font and resolves a real Pango.FontDescription", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import Pango from "gi:Pango-1.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, installCss, VFontDialog } from "@zede/vio";
    Gtk.init();
    installCss("slider { min-width: 16px; min-height: 16px; }");
    const pump = (iterations = 300) => {
      for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
    };
    const parent = new Gtk.Window({ title: "font parent" });
    parent.present();
    pump();
    await new Promise((resolve) => setTimeout(resolve, 30));
    pump();
    let handle;
    const requested = Pango.FontDescription.fromString("Noto Sans 12");
    const app = createApp({
      setup: () => () => h(VFontDialog, {
        ref: (value) => (handle = value),
        title: "pick",
        fontDesc: requested,
      }),
    });
    app.mount();
    const pending = handle.chooseFont(parent);
    let dialog;
    let accept;
    for (let index = 0; index < 50 && !accept?.getSensitive(); index++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      pump();
      dialog = Gtk.Window.listToplevels().find((window) => window instanceof Gtk.Dialog);
      accept = dialog?.getWidgetForResponse(Gtk.ResponseType.OK);
    }
    if (!dialog) throw new Error("the font dialog did not present a Gtk.Dialog");
    if (!accept?.getSensitive())
      throw new Error("the preselect font did not enable the Select button");
    accept.emit("clicked");
    pump();
    const result = await pending;
    if (!(result instanceof Pango.FontDescription))
      throw new Error("the accepted font is not a Pango.FontDescription");
    // fontconfig substitutes a family when the requested one is missing (CI has no Noto Sans),
    // so the resolved description must keep the size and carry a family, not the exact name.
    if (result.getSize() !== requested.getSize())
      throw new Error("the dialog resolved a different size: " + result.toString());
    if (!result.getFamily()) throw new Error("the dialog resolved a font without a family");
    if (handle.pending) throw new Error("pending was not cleared");
    // A second request without a selection is still cancellable and resolves null, not rejects.
    const second = handle.chooseFont(parent);
    await new Promise((resolve) => setTimeout(resolve, 100));
    pump();
    if (!handle.cancel()) throw new Error("cancel() returned false");
    if (await second !== null) throw new Error("cancellation did not resolve null");
    app.unmount();
    parent.destroy();
    console.log("font-ok " + result.toString());
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
  assert.match(result.stdout.trim(), /^font-ok \S/);
  // GTK 4.14 (CI) reports negative minimum sizes for the font dialog's internal sliders even
  // with the local slider CSS rule; see docs/limitations.md. Nothing else may warn.
  const stderr = result.stderr
    .split(/\r?\n/)
    .filter(
      (line) => !/\(slider\) reported min (?:width|height) -\d+, but sizes must be >= 0/.test(line),
    )
    .join("\n");
  assert.doesNotMatch(stderr, /Gtk-WARNING|Gtk-CRITICAL/);
  assert.doesNotMatch(stderr, /GLib-CRITICAL|GLib-GObject-CRITICAL|Gdk-CRITICAL/);
});

await test("VFileDialog keeps the realized-parent workaround and cancels safely", () => {
  const source = `
    import Gtk from "gi:Gtk-4.0";
    import GLib from "gi:GLib-2.0";
    import { createApp, h, VFileDialog } from "@zede/vio";
    Gtk.init();
    const pump = (iterations = 200) => {
      for (let index = 0; index < iterations; index++) GLib.MainContext.default().iteration(false);
    };
    const parent = new Gtk.Window({ title: "file parent" });
    parent.present();
    pump();
    await new Promise((resolve) => setTimeout(resolve, 30));
    pump();
    if (!parent.getRealized()) throw new Error("the parent is not realized");
    let handle;
    const app = createApp({ setup: () => () => h(VFileDialog, { ref: (value) => (handle = value) }) });
    app.mount();
    const immediate = handle.open(parent);
    if (!handle.cancel()) throw new Error("cancel() returned false");
    if (await immediate !== null) throw new Error("immediate cancellation did not resolve null");

    const pending = handle.open(parent);
    await new Promise((resolve) => setTimeout(resolve, 80));
    pump();
    if (!handle.pending) throw new Error("the second open is not pending");
    if (!handle.cancel()) throw new Error("cancel() returned false");
    if (await pending !== null) throw new Error("cancellation did not resolve null");
    app.unmount();
    parent.destroy();
    console.log("file-realized-ok");
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
  assert.equal(result.stdout.trim(), "file-realized-ok");
  assert.doesNotMatch(result.stderr, /Gtk-WARNING|Gtk-CRITICAL/);
});

await test("VShortcutsWindow shows declarative sections, groups and shortcuts", async () => {
  const showSecond = ref(true);
  let section;
  let group;
  let shortcut;
  let second;
  const app = mount(() =>
    h(
      VShortcutsWindow,
      { visible: true, title: "Keys" },
      {
        default: () =>
          h(
            VShortcutsSection,
            {
              ref: (value) => (section = value),
              title: "Editing",
              sectionName: "edit",
            },
            {
              default: () =>
                h(
                  VShortcutsGroup,
                  { ref: (value) => (group = value), title: "Files" },
                  {
                    default: () => [
                      h(VShortcutsShortcut, {
                        ref: (value) => (shortcut = value),
                        title: "Open",
                        accelerator: "<Control>o",
                      }),
                      showSecond.value
                        ? h(VShortcutsShortcut, {
                            key: "second",
                            ref: (value) => (second = value),
                            title: "Save",
                            accelerator: "<Control>s",
                          })
                        : null,
                    ],
                  },
                ),
            },
          ),
      },
    ),
  );
  try {
    await settle();
    const window = widgetOf(app);
    assert.ok(window instanceof Gtk.ShortcutsWindow);
    assert.ok(section.widget instanceof Gtk.ShortcutsSection);
    assert.ok(group.widget instanceof Gtk.ShortcutsGroup);
    assert.ok(shortcut.widget instanceof Gtk.ShortcutsShortcut);
    assert.equal(section.widget.getProperty("title"), "Editing");
    assert.equal(section.widget.getProperty("section-name"), "edit");
    assert.equal(group.widget.getProperty("title"), "Files");
    assert.equal(shortcut.widget.getProperty("title"), "Open");
    assert.equal(shortcut.widget.getProperty("accelerator"), "<Control>o");
    let ancestor = section.widget.getParent();
    while (ancestor && ancestor !== window) ancestor = ancestor.getParent();
    assert.equal(ancestor, window, "the section is parented inside the shortcuts window");
    assert.ok(
      children(group.widget).some((widget) => widget instanceof Gtk.ShortcutsShortcut),
      "the shortcut is parented inside its group",
    );
    assert.equal(window.getVisible(), true);
    assert.ok(labelsIn(window).includes("Open"), "the presented window renders the shortcut title");

    const secondWidget = second.widget;
    showSecond.value = false;
    await nextTick();
    await settle();
    assert.equal(secondWidget.getParent(), null, "a removed shortcut is unparented");
    assert.ok(
      children(group.widget).some((widget) => widget === shortcut.widget),
      "a sibling shortcut stays attached",
    );
  } finally {
    app.unmount();
  }
});

await test("VShortcutsGroup reorders shortcuts in place; sections and groups stay append-only", async () => {
  const items = ref(["a", "b", "c"]);
  const sections = [];
  const groups = [];
  const shortcutRefs = new Map();
  const shortcut = (key) =>
    h(VShortcutsShortcut, {
      key,
      ref: (value) => shortcutRefs.set(key, value),
      title: key.toUpperCase(),
      accelerator: `<Control>${key}`,
    });
  const section = (index, title) =>
    h(
      VShortcutsSection,
      {
        ref: (value) => (sections[index] = value),
        title,
        sectionName: `s${index}`,
      },
      {
        default: () =>
          index === 0
            ? [
                h(
                  VShortcutsGroup,
                  { ref: (value) => (groups[0] = value), title: "G1" },
                  { default: () => items.value.map(shortcut) },
                ),
                h(VShortcutsGroup, { ref: (value) => (groups[1] = value), title: "G2" }),
                h(VShortcutsGroup, { ref: (value) => (groups[2] = value), title: "G3" }),
              ]
            : h(VShortcutsGroup, { title: `${title} group` }),
      },
    );
  const app = mount(() =>
    h(
      VShortcutsWindow,
      { visible: true, title: "Keys" },
      { default: () => [section(0, "S1"), section(1, "S2"), section(2, "S3")] },
    ),
  );
  try {
    await settle();
    const group = groups[0].widget;
    if (!(group instanceof Gtk.ShortcutsGroup)) throw new Error("missing group");
    const order = () =>
      children(group)
        .filter((widget) => widget instanceof Gtk.ShortcutsShortcut)
        .map((widget) => widget.getProperty("title"));
    assert.deepEqual(order(), ["A", "B", "C"]);
    assert.ok(children(group)[0] instanceof Gtk.Label, "the group title label stays first");

    const widgets = new Map(
      [...shortcutRefs].map(([key, handle]) => [key.toUpperCase(), handle.widget]),
    );
    const rootNotifications = new Map();
    for (const [key, widget] of widgets) {
      rootNotifications.set(key, 0);
      widget.on("notify::root", () => rootNotifications.set(key, rootNotifications.get(key) + 1));
    }
    let groupRootNotifications = 0;
    group.on("notify::root", () => groupRootNotifications++);

    items.value = ["b", "c", "a"];
    await settle();
    assert.deepEqual(order(), ["B", "C", "A"], "the first shortcut moved to the end");
    assert.ok(children(group)[0] instanceof Gtk.Label, "the title label is still first");
    for (const [key, widget] of widgets) {
      assert.equal(widget.getParent(), group, `${key}: the shortcut stayed in the group`);
      assert.equal(rootNotifications.get(key), 0, `${key}: the shortcut was not unparented`);
    }
    assert.equal(groupRootNotifications, 0, "the group was not unparented");

    items.value = ["a", "b", "c"];
    await settle();
    assert.deepEqual(order(), ["A", "B", "C"], "the shortcut moved back to the front");
    for (const [key, widget] of widgets) {
      assert.equal(widget.getParent(), group, `${key}: identity survived the move back`);
      assert.equal(rootNotifications.get(key), 0, `${key}: no unparent on the way back`);
    }
    assert.equal(groupRootNotifications, 0, "the group root stayed stable");

    // GTK puts sections in an internal Gtk.Stack and distributes groups into column boxes.
    // Neither container offers a keyed reorder, so only shortcut rows are keyed-movable.
    const sectionParents = sections.map((handle) => handle.widget.getParent());
    assert.ok(
      sectionParents.every((parent) => parent instanceof Gtk.Stack),
      "sections are appended to the window's Gtk.Stack",
    );
    assert.equal(
      typeof sectionParents[0].reorderChildAfter,
      "undefined",
      "Gtk.Stack has no reorderChildAfter",
    );
    const stackSections = [];
    for (let node = sectionParents[0].getFirstChild(); node; node = node.getNextSibling())
      if (node instanceof Gtk.ShortcutsSection) stackSections.push(node.getProperty("title"));
    assert.deepEqual(stackSections, ["S1", "S2", "S3"], "sections keep declaration order");
    const groupParents = groups.map((handle) => handle.widget.getParent());
    assert.ok(
      groupParents.every((parent) => parent !== sections[0].widget && parent instanceof Gtk.Box),
      "groups live in internal column boxes, not in the section itself",
    );
    assert.ok(
      new Set(groupParents).size > 1,
      "GTK distributes three groups over more than one column box",
    );
  } finally {
    app.unmount();
  }
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
    "vio-shortcuts-window",
    "vio-shortcuts-section",
    "vio-shortcuts-group",
    "vio-shortcuts-shortcut",
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
      VPageSetupUnixDialog, VPrintUnixDialog, VShortcutsGroup, VShortcutsSection,
      VShortcutsShortcut, VShortcutsWindow, VWindow,
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
        h(VShortcutsWindow, { title: "keys" }, {
          default: () => h(VShortcutsSection, { title: "Editing" }, {
            default: () => h(VShortcutsGroup, { title: "Files" }, {
              default: () => h(VShortcutsShortcut, { title: "Open", accelerator: "<Control>o" }),
            }),
          }),
        }),
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
