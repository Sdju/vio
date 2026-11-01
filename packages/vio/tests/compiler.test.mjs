import assert from "node:assert/strict";
import { test } from "node:test";
import { compileSfc } from "../dist/compiler.mjs";

await test("SFC compilation targets @zede/vio, strips TS and keeps normal Vue list/model expressions", () => {
  const code = compileSfc(
    `<script setup lang="ts">
    import { ref } from "vue";
    import { VBox, VEntry, VLabel } from "@zede/vio";
    const query = ref<string>(""); const items: string[] = ["one", "two"];
    </script><template><VBox><VEntry v-model="query"/><VLabel v-for="item in items" :key="item">{{ item }}</VLabel></VBox></template>`,
    "list.vue",
  );
  assert.match(code, /from "@zede\/vio"/);
  assert.doesNotMatch(code, /from\s*["'](?:vio|vue)["']/);
  assert.match(code, /renderList/);
  assert.match(code, /onUpdate:modelValue/);
  assert.doesNotMatch(code, /runtime-dom|ref<string>|items: string\[\]/);
});

await test("template-only and Options API SFCs receive a render function", () => {
  for (const script of [
    "",
    '<script>export default { data: () => ({ greeting: "hello" }) }</script>',
  ]) {
    const code = compileSfc(
      `${script}<template><gtk-label>{{ greeting }}</gtk-label></template>`,
      "options.vue",
    );
    assert.match(code, /__vio_component.render = __vio_render/);
    assert.match(code, /gtk-label/);
    assert.match(code, /from "@zede\/vio"/);
  }
});

await test("script setup templates treat gtk-* tags as custom elements", () => {
  const code = compileSfc(
    '<script setup lang="ts">const day = 1</script><template><gtk-calendar :day="day"/></template>',
    "generic.vue",
  );
  assert.doesNotMatch(code, /resolveComponent\("gtk-calendar"\)/);
  assert.match(code, /createElementBlock\("gtk-calendar"/);
});

await test("scoped styles use GTK classes instead of DOM attributes and have lifecycle cleanup", () => {
  const code = compileSfc(
    '<template><gtk-label class="heading">hello</gtk-label></template><style scoped>.heading { font-size: 22px; }</style>',
    "scoped.vue",
  );
  assert.match(code, /withStyles/);
  assert.match(code, /from '@zede\/vio'/);
  assert.match(code, /\.heading\.vio-[a-f\d]+/);
  assert.doesNotMatch(code, /\[data-v-/);
});

await test("control components accept v-model and v-model:argument", () => {
  const code = compileSfc(
    `<script setup lang="ts">
    import { ref, VScale, VToggleButton } from "@zede/vio";
    const active = ref<boolean>(false); const value = ref<number>(0.5);
    </script><template><VToggleButton v-model:active="active"/><VScale v-model:value="value"/></template>`,
    "controls.vue",
  );
  assert.match(code, /onUpdate:active/);
  assert.match(code, /onUpdate:value/);
});

await test("wave 2 data components accept v-model and v-model:argument", () => {
  const code = compileSfc(
    `<script setup lang="ts">
    import { ref, VColumnView, VSearchEntry, VTextView } from "@zede/vio";
    const text = ref<string>(""); const selected = ref<number>(0);
    </script><template><VTextView v-model:text="text"/><VSearchEntry v-model:text="text"/><VColumnView v-model:selected="selected"/></template>`,
    "data.vue",
  );
  assert.match(code, /onUpdate:text/);
  assert.match(code, /onUpdate:selected/);
});

await test("wave 3 VDialog accepts v-model:visible", () => {
  const code = compileSfc(
    `<script setup lang="ts">
    import { ref, VDialog } from "@zede/vio";
    const open = ref<boolean>(false);
    </script><template><VDialog v-model:visible="open"/></template>`,
    "dialog.vue",
  );
  assert.match(code, /onUpdate:visible/);
});

await test("unsupported DOM semantics fail with actionable diagnostics", () => {
  assert.throws(
    () => compileSfc('<template><gtk-label v-html="text"/></template>', "bad.vue"),
    /DOM directive/,
  );
  assert.throws(
    () => compileSfc('<template><gtk-entry v-model="query"/></template>', "bad.vue"),
    /supported on VEntry/,
  );
  assert.throws(
    () => compileSfc('<template><gtk-button @clicked.prevent="click"/></template>', "bad.vue"),
    /DOM event modifiers/,
  );
  assert.throws(() => compileSfc('<template src="x.html"/>', "bad.vue"), /external SFC blocks/);
});
