<script setup lang="ts">
import Gtk from "gi:Gtk-4.0";
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import {
  VBox,
  VButton,
  VCalendar,
  VColorButton,
  VColorDialogButton,
  VColumnView,
  VColumnViewColumn,
  VDrawingArea,
  VFilterListModel,
  VFontButton,
  VFontDialogButton,
  VGLArea,
  VLabel,
  VMediaFile,
  VMediaControls,
  VPicture,
  VSortListModel,
  VStringList,
  VVideo,
  VWindow,
  computed,
  ref,
  shallowRef,
  useNative,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();

const people = [
  "Ada Lovelace",
  "Grace Hopper",
  "Linus Torvalds",
  "Margaret Hamilton",
  "Alan Turing",
  "Barbara Liskov",
];
const items = ref(people);
const query = ref("");

const stringList = ref();
const filterModel = ref();
const sortModel = ref();
const filtered = computed(() => filterModel.value?.filterListModel ?? null);
const sorted = computed(() => sortModel.value?.sortListModel ?? null);
const predicate = computed(
  () => (item: { getString(): string }) =>
    item.getString().toLowerCase().includes(query.value.trim().toLowerCase()),
);
const compare = computed(
  () => (left: { getString(): string }, right: { getString(): string }) =>
    left.getString().localeCompare(right.getString()),
);

const icon = useNative(
  Gtk.IconTheme.getForDisplay(Gdk.Display.getDefault()).lookupIcon(
    "applications-multimedia",
    null,
    72,
    1,
    Gtk.TextDirection.NONE,
    0,
  ),
);

const rgba = shallowRef("#3366cc");
const font = ref("Sans 12");
const date = shallowRef(GLib.DateTime.newLocal(2026, 11, 1, 12, 0, 0));
const rgbaLabel = computed(() =>
  typeof rgba.value === "string" ? rgba.value : (rgba.value?.toString?.() ?? "—"),
);
const dateLabel = computed(() =>
  typeof date.value === "string" ? date.value : (date.value?.format?.("%Y-%m-%d") ?? "—"),
);

const media = ref();
const notes = [
  "VStringList keeps Gtk.StringList in sync with the items array.",
  "VFilterListModel applies the predicate; VSortListModel orders the result.",
  "VMediaFile reads an empty state when no playable file is configured.",
];

function draw(_area: unknown, context: any, width: number, height: number) {
  const gradient = context.createLinearGradient?.(0, 0, width, height);
  if (gradient) {
    gradient.addColorStop?.(0, "#1f4e79");
    gradient.addColorStop?.(1, "#3d9970");
    context.setSource?.(gradient);
  } else {
    context.setSourceRgb(0.15, 0.35, 0.5);
  }
  context.rectangle(0, 0, width, height);
  context.fill();
  context.setSourceRgba(1, 1, 1, 0.75);
  for (let index = 0; index < 6; index++) {
    context.rectangle(12 + index * 34, height - 20 - index * 12, 20, 12 + index * 12);
    context.fill();
  }
}

function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · media, canvas and values"
    :default-width="820"
    :default-height="900"
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
      <VLabel class="heading">Wave 4: media, canvas and value pickers</VLabel>

      <VBox orientation="horizontal" :spacing="18">
        <gtk-frame label="VPicture" :hexpand="true">
          <VPicture
            :paintable="icon"
            content-fit="contain"
            alternative-text="media icon"
            :height-request="96"
          />
        </gtk-frame>
        <gtk-frame label="VCalendar" :hexpand="true">
          <VBox :spacing="4">
            <VCalendar v-model:date="date" :show-week-numbers="true" />
            <VLabel>{{ dateLabel }}</VLabel>
          </VBox>
        </gtk-frame>
      </VBox>

      <VBox orientation="horizontal" :spacing="12">
        <VColorButton v-model:rgba="rgba" :use-alpha="true" title="Accent color" :hexpand="true" />
        <VColorDialogButton v-model:rgba="rgba" :hexpand="true" />
        <VFontButton v-model:font="font" :use-font="true" :hexpand="true" />
        <VFontDialogButton v-model:font="font" :hexpand="true" />
      </VBox>
      <VLabel>rgba: {{ rgbaLabel }} · font: {{ font }}</VLabel>

      <VBox orientation="horizontal" :spacing="12">
        <gtk-frame label="VDrawingArea (Cairo)" :hexpand="true">
          <VDrawingArea
            :draw="draw"
            :content-width="300"
            :content-height="140"
            :height-request="150"
          />
        </gtk-frame>
        <gtk-frame label="VGLArea" :hexpand="true">
          <VGLArea :has-depth-buffer="true" :auto-render="true" :height-request="150" />
        </gtk-frame>
      </VBox>

      <gtk-frame label="Video empty state">
        <VBox :spacing="6">
          <VVideo :height-request="80" />
          <VMediaControls />
          <VLabel>No media file is configured; GStreamer decoders are not required.</VLabel>
          <VMediaFile ref="media" />
        </VBox>
      </gtk-frame>

      <gtk-frame label="VStringList → VFilterListModel → VSortListModel" :vexpand="true">
        <VBox :spacing="8">
          <VStringList ref="stringList" :items="items" />
          <VFilterListModel
            ref="filterModel"
            :model="stringList?.stringList"
            :predicate="predicate"
          />
          <VSortListModel ref="sortModel" :model="filtered" :compare="compare" />
          <VColumnView :model="sorted" selection-mode="none" :height-request="170">
            <template #columns>
              <VColumnViewColumn title="Name" :expand="true">
                <template #cell="{ item }">
                  <VLabel>{{ item?.getString() }}</VLabel>
                </template>
              </VColumnViewColumn>
            </template>
          </VColumnView>
          <VBox orientation="horizontal" :spacing="8">
            <VButton @clicked="query = ''">All</VButton>
            <VButton @clicked="query = 'a'">Names with “a”</VButton>
            <VButton @clicked="query = 'z'">Names with “z”</VButton>
          </VBox>
        </VBox>
      </gtk-frame>

      <VLabel class="hint">{{ notes.join(" ") }}</VLabel>
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading {
  font-size: 20px;
}

.hint {
  opacity: 0.7;
}
</style>
