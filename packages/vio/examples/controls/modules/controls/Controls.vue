<script setup lang="ts">
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  ref,
  useNative,
  VBox,
  VDropDown,
  VExpander,
  VLabel,
  VMenuButton,
  VProgressBar,
  VScale,
  VSpinButton,
  VStack,
  VStackSwitcher,
  VWindow,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();
const value = ref(0.4);
const expanded = ref(true);
const selected = ref(0);
const stack = ref<{ widget: object | null } | null>(null);
const items = useNative(Gio.ListStore.new(getGType(Gtk.StringObject)));

for (const name of ["Alpha", "Beta", "Gamma"]) items.value?.append(Gtk.StringObject.new(name));

function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · controls and layout"
    :default-width="640"
    :default-height="680"
    :visible="true"
    @close-request="close"
  >
    <VBox
      orientation="vertical"
      :spacing="14"
      :margin-top="18"
      :margin-bottom="18"
      :margin-start="18"
      :margin-end="18"
    >
      <VLabel class="heading">Wave 1: controls and layout</VLabel>

      <VExpander v-model:expanded="expanded">
        <template #label>
          <VLabel>Expander with a widget label</VLabel>
        </template>
        <VBox :spacing="6">
          <VLabel>The content goes through GtkExpander.setChild().</VLabel>
          <VLabel>The header goes through GtkExpander.setLabelWidget().</VLabel>
        </VBox>
      </VExpander>

      <VMenuButton>
        <VLabel>Open popover</VLabel>
        <template #popover>
          <VBox
            :spacing="6"
            :margin-top="10"
            :margin-bottom="10"
            :margin-start="10"
            :margin-end="10"
          >
            <VLabel>Popover content from the #popover slot.</VLabel>
            <VLabel>The button child and the popup use different slots.</VLabel>
          </VBox>
        </template>
      </VMenuButton>

      <VLabel>Shared v-model:value</VLabel>
      <VScale v-model:value="value" :min="0" :max="1" :step="0.05" draw-value />
      <VSpinButton v-model:value="value" :min="0" :max="1" :step="0.05" :digits="2" />
      <VProgressBar v-model:value="value" show-text />

      <VLabel>DropDown with three strings</VLabel>
      <VDropDown v-model="selected" :model="items" />

      <VLabel>Stack and StackSwitcher</VLabel>
      <VStack ref="stack" :vexpand="true">
        <VBox name="one">
          <VLabel>First stack page</VLabel>
        </VBox>
        <VBox name="two">
          <VLabel>Second stack page</VLabel>
        </VBox>
      </VStack>
      <VStackSwitcher v-if="stack?.widget" :stack="stack.widget" />
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading {
  font-size: 20px;
}
</style>
