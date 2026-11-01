<script setup lang="ts">
import Gio from "gi:Gio-2.0";
import { useNative, VBox, VLabel, VWindow } from "@zede/vio";

const props = defineProps<{ quit: () => void }>();
const menu = useNative(
  (() => {
    const model = Gio.Menu.new();
    model.append("Generic widgets", "app.generic");
    model.append("Quit", "app.quit");
    return model;
  })(),
);

function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · generic Gtk widgets"
    :default-width="520"
    :default-height="640"
    :visible="true"
    @close-request="close"
  >
    <VBox
      orientation="vertical"
      :spacing="12"
      :margin-top="18"
      :margin-bottom="18"
      :margin-start="18"
      :margin-end="18"
    >
      <VLabel class="heading">gtk-* resolved from introspection</VLabel>
      <gtk-calendar :show-heading="false" />
      <gtk-level-bar :value="0.65" />
      <gtk-frame label="gtk-frame">
        <VLabel>One child through GtkFrame.setChild()</VLabel>
      </gtk-frame>
      <gtk-popover-menu :menu-model="menu" />
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading {
  font-size: 20px;
}
</style>
