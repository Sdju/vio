<script setup lang="ts">
import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import GObject from "gi:GObject-2.0";
import { getGType } from "node-gtk";
import {
  VBox,
  VButton,
  VCellRendererText,
  VCellRendererToggle,
  VColumnView,
  VColumnViewColumn,
  VGridView,
  VInfoBar,
  VLabel,
  VSearchEntry,
  VTextView,
  VToggleButton,
  VTreeView,
  VTreeViewColumn,
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

const treeStore = Gtk.TreeStore.new([GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]);
function appendRow(parent, label, active) {
  const iter = treeStore.append(parent);
  const text = new GObject.Value();
  text.init(GObject.TYPE_STRING);
  text.setString(label);
  treeStore.setValue(iter, 0, text);
  const flag = new GObject.Value();
  flag.init(GObject.TYPE_BOOLEAN);
  flag.setBoolean(active);
  treeStore.setValue(iter, 1, flag);
  return iter;
}
const team = appendRow(null, "Team", false);
appendRow(team, "Ada Lovelace", true);
appendRow(team, "Grace Hopper", true);
const guests = appendRow(null, "Guests", false);
appendRow(guests, "Alan Turing", false);
const editedLog = ref("Edit a name or toggle a row.");

function writeValue(path, column, value) {
  const [found, iter] = treeStore.getIterFromString(path);
  if (!found) return;
  treeStore.setValue(iter, column, value);
}
function onEdited(path, text) {
  const value = new GObject.Value();
  value.init(GObject.TYPE_STRING);
  value.setString(text);
  writeValue(path, 0, value);
  editedLog.value = `edited ${path}: ${text}`;
}
function onToggled(path) {
  const [found, iter] = treeStore.getIterFromString(path);
  if (!found) return;
  const value = new GObject.Value();
  value.init(GObject.TYPE_BOOLEAN);
  value.setBoolean(!treeStore.getValue(iter, 1).getBoolean());
  treeStore.setValue(iter, 1, value);
  editedLog.value = `toggled ${path}`;
}

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

      <gtk-frame label="VTreeView (TreeStore + cell renderers)">
        <VBox :spacing="4">
          <VTreeView :model="treeStore" :headers-visible="true" :height-request="150">
            <template #columns>
              <VTreeViewColumn title="Name" :expand="true" :resizable="true" :sort-column-id="0">
                <VCellRendererText :column="0" :editable="true" @edited="onEdited" />
              </VTreeViewColumn>
              <VTreeViewColumn title="Active" :sort-column-id="1">
                <VCellRendererToggle :column="1" @toggled="onToggled" />
              </VTreeViewColumn>
            </template>
          </VTreeView>
          <VLabel class="hint">{{ editedLog }}</VLabel>
        </VBox>
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
