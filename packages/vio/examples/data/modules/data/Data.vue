<script setup lang="ts">
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { getGType } from "node-gtk";
import {
  VBox,
  VButton,
  VColumnView,
  VColumnViewColumn,
  VGridView,
  VInfoBar,
  VLabel,
  VSearchEntry,
  VTextView,
  VToggleButton,
  VWindow,
  ref,
  useNative,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();

const all = [
  "Ada Lovelace",
  "Grace Hopper",
  "Linus Torvalds",
  "Margaret Hamilton",
  "Alan Turing",
  "Barbara Liskov",
  "Edsger Dijkstra",
  "Katherine Johnson",
];

const store = useNative(Gio.ListStore.new(getGType(Gtk.StringObject)));
const query = ref("");
const count = ref(0);
const selected = ref(0);
const gridSelected = ref(0);
const showInfo = ref(true);
const notes = ref("Both views share one Gio.ListStore.\nEdit the query to filter it.");

function rebuild() {
  const needle = query.value.trim().toLowerCase();
  const items = all.filter((name) => name.toLowerCase().includes(needle));
  store.value?.splice(
    0,
    store.value.getNItems(),
    items.map((name) => Gtk.StringObject.new(name)),
  );
  count.value = items.length;
}
rebuild();

function closeInfo() {
  showInfo.value = false;
}

function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · data and panels"
    :default-width="760"
    :default-height="820"
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
      <VLabel class="heading">Wave 2: data and panels</VLabel>

      <VSearchEntry
        v-model:text="query"
        placeholder-text="Filter the shared store"
        @search="rebuild"
      />

      <VBox orientation="horizontal" :spacing="10">
        <VToggleButton v-model:active="showInfo">
          <VLabel>Info bar</VLabel>
        </VToggleButton>
        <VLabel>{{ count }} rows</VLabel>
      </VBox>

      <VInfoBar
        v-if="showInfo"
        message-type="info"
        :show-close-button="true"
        @response="closeInfo"
        @close="closeInfo"
      >
        <template #content>
          <VLabel>The search entry filters the store behind both views.</VLabel>
        </template>
        <template #action>
          <VButton @clicked="closeInfo">Dismiss</VButton>
        </template>
      </VInfoBar>

      <gtk-frame label="VColumnView">
        <VColumnView
          v-model:selected="selected"
          :model="store"
          selection-mode="single"
          :show-row-separators="true"
          :vexpand="true"
          :height-request="240"
        >
          <template #columns>
            <VColumnViewColumn title="Name" :expand="true">
              <template #cell="{ item, position }">
                <VLabel>{{ position + 1 }}. {{ item?.getString() }}</VLabel>
              </template>
            </VColumnViewColumn>
            <VColumnViewColumn title="Length" :fixed-width="90">
              <template #cell="{ item }">
                <VLabel>{{ item?.getString()?.length ?? 0 }}</VLabel>
              </template>
            </VColumnViewColumn>
          </template>
        </VColumnView>
      </gtk-frame>

      <gtk-frame label="VGridView">
        <VGridView
          v-model:selected="gridSelected"
          :model="store"
          selection-mode="single"
          :min-columns="2"
          :max-columns="3"
          :height-request="190"
        >
          <template #item="{ item }">
            <VBox :spacing="2">
              <VLabel class="tile">{{ item?.getString()?.slice(0, 1) }}</VLabel>
              <VLabel>{{ item?.getString() }}</VLabel>
            </VBox>
          </template>
        </VGridView>
      </gtk-frame>

      <gtk-frame label="VTextView">
        <VTextView
          v-model:text="notes"
          :editable="true"
          wrap-mode="word-char"
          :height-request="110"
        />
      </gtk-frame>
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading {
  font-size: 20px;
}

.tile {
  font-size: 22px;
  font-weight: bold;
}
</style>
