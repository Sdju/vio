import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the archive as a consumer: no workspace links and no Projector dependency.
const directory = mkdtempSync(join(tmpdir(), "vio-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: "inherit" });
try {
  execFileSync("vp", ["pm", "pack", "--filter", "@zede/vio", "--pack-destination", directory], {
    stdio: "inherit",
  });
  const archive = readdirSync(directory).find((name) => name.endsWith(".tgz"));
  assert.ok(archive, "pnpm pack must produce an archive");
  writeFileSync(join(directory, ".node-version"), readFileSync(".node-version"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "vio-consumer",
      private: true,
      type: "module",
      allowScripts: { "node-gtk": true },
    }),
  );
  run(["install", join(directory, archive), "--no-audit", "--no-fund"], directory);
  const script = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createRoot, createVioRenderer } from "@zede/vio/core";
import { compileSfc } from "@zede/vio/compiler";
assert.equal(createRoot().kind, "root");
assert.equal(typeof createVioRenderer, "function");
assert.throws(() => createRequire(import.meta.url).resolve("vio"), {code: "MODULE_NOT_FOUND"});
const code = compileSfc('<template><gtk-label>hello</gtk-label></template>', '/tmp/Hello.vue');
assert.ok(code.includes('@zede/vio'));
console.log("Packed core and compiler exports passed");
`;
  writeFileSync(join(directory, "smoke.mjs"), script);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: directory, stdio: "inherit" });
  if (process.env.VIO_TEST_GTK === "1") {
    writeFileSync(
      join(directory, "Counter.vue"),
      `<script setup lang="ts">import { ref, VWindow, VLabel } from "@zede/vio";const count = ref<number>(7);</script><template><VWindow><VLabel>{{ count }}</VLabel></VWindow></template><style scoped>label { font-size: 16px; }</style>`,
    );
    writeFileSync(
      join(directory, "gtk.mjs"),
      `
import assert from "node:assert/strict";
import Gtk from "gi:Gtk-4.0";
import { createApp } from "@zede/vio";
import Counter from "./Counter.vue";
Gtk.init();
const app = createApp(Counter);
app.mount();
assert.equal(app.root.children[0].widget.getChild().getLabel(), "7");
app.unmount();
assert.equal(app.root.children.length, 0);
console.log("Packed SFC loader and real GTK widgets passed");
`,
    );
    execFileSync(process.execPath, ["--import", "@zede/vio/register", "gtk.mjs"], {
      cwd: directory,
      stdio: "inherit",
    });
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
