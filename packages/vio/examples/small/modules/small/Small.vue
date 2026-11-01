<script setup lang="ts">
import Gio from "gi:Gio-2.0";
import GLib from "gi:GLib-2.0";
import {
  VBox,
  VAspectFrame,
  VButton,
  VEmojiChooser,
  VFrame,
  VGraphicsOffload,
  VHeaderBar,
  VLabel,
  VLockButton,
  VMenuButton,
  VPopover,
  VPopoverBin,
  VRevealer,
  VScaleButton,
  VScrollbar,
  VShortcutLabel,
  VSvgWidget,
  VToggleButton,
  VTreeExpander,
  VViewport,
  VVolumeButton,
  VWindow,
  VWindowControls,
  VWindowHandle,
  computed,
  ref,
  shallowRef,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();

const revealed = ref(true);
const scroll = ref(35);
const scale = ref(0.4);
const volume = ref(0.6);
const permission = shallowRef<Gio.Permission>(Gio.SimplePermission.new(true));
const emoji = ref("—");
const permissionLabel = computed(() =>
  permission.value?.getAllowed?.() === false ? "locked" : "unlocked",
);

const svgMarkup =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="10" fill="#3366cc"/><circle cx="40" cy="40" r="18" fill="#e6f0ff"/><rect x="70" y="26" width="34" height="28" rx="6" fill="#99bbff"/></svg>';
const svgBytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(svgMarkup)));

const notes = [
  "VFrame routes #label-widget to GtkFrame:label-widget.",
  "VRevealer binds reveal-child; child-revealed is exposed on the handle.",
  "VScrollbar and VScaleButton keep a GtkAdjustment in sync.",
  "VEmojiChooser and VPopoverBin are popovers and need a parent.",
];

function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · small and special widgets"
    :default-width="900"
    :default-height="920"
    :visible="true"
    @close-request="close"
  >
    <VHeaderBar role="titlebar">
      <template #start>
        <VWindowHandle>
          <VLabel>Wave 5 · small widgets</VLabel>
        </VWindowHandle>
      </template>
      <template #end>
        <VButton @clicked="revealed = !revealed">{{ revealed ? "Hide" : "Reveal" }}</VButton>
      </template>
    </VHeaderBar>

    <VBox
      orientation="vertical"
      :spacing="12"
      :margin-top="18"
      :margin-bottom="18"
      :margin-start="18"
      :margin-end="18"
    >
      <VLabel class="heading">Wave 5: small and special widgets</VLabel>

      <VBox orientation="horizontal" :spacing="14">
        <VFrame label="VFrame" :hexpand="true">
          <template #label-widget>
            <VLabel>label widget</VLabel>
          </template>
          <VLabel>Frame content with a custom header widget.</VLabel>
        </VFrame>

        <VFrame label="VViewport" :hexpand="true">
          <VViewport :height-request="90">
            <VBox :spacing="6">
              <VLabel>Viewport child one</VLabel>
              <VLabel>Viewport child two</VLabel>
              <VLabel>GtkViewport has scrollTo() but no scroll-to signal on 4.24.</VLabel>
            </VBox>
          </VViewport>
        </VFrame>
      </VBox>

      <VBox orientation="horizontal" :spacing="14">
        <VFrame label="VRevealer" :hexpand="true">
          <VBox :spacing="8">
            <VToggleButton v-model:active="revealed">Reveal content</VToggleButton>
            <VRevealer
              v-model:revealed="revealed"
              transition-type="slide-down"
              :transition-duration="220"
            >
              <VLabel>Sliding content is back.</VLabel>
            </VRevealer>
          </VBox>
        </VFrame>

        <VFrame label="VAspectFrame" :hexpand="true">
          <VAspectFrame :ratio="16 / 9" :obey-child="false" :xalign="0.5" :yalign="0.5">
            <VLabel>16:9 content box</VLabel>
          </VAspectFrame>
        </VFrame>
      </VBox>

      <VFrame label="Ranges and volume">
        <VBox :spacing="8">
          <VBox orientation="horizontal" :spacing="10">
            <VScrollbar
              v-model:value="scroll"
              :min="0"
              :max="100"
              :step="5"
              orientation="horizontal"
              :hexpand="true"
            />
            <VLabel class="value">scroll {{ scroll }}</VLabel>
          </VBox>
          <VBox orientation="horizontal" :spacing="10">
            <VScaleButton
              v-model:value="scale"
              :icons="[
                'audio-volume-muted-symbolic',
                'audio-volume-low-symbolic',
                'audio-volume-medium-symbolic',
                'audio-volume-high-symbolic',
              ]"
            />
            <VLabel class="value">scale {{ scale.toFixed(2) }}</VLabel>
            <VVolumeButton v-model:value="volume" />
            <VLabel class="value">volume {{ volume.toFixed(2) }}</VLabel>
          </VBox>
        </VBox>
      </VFrame>

      <VBox orientation="horizontal" :spacing="14">
        <VFrame label="VLockButton" :hexpand="true">
          <VBox :spacing="6">
            <VLockButton v-model:permission="permission" />
            <VLabel>Permission is {{ permissionLabel }}.</VLabel>
          </VBox>
        </VFrame>

        <VFrame label="VShortcutLabel" :hexpand="true">
          <VBox :spacing="6">
            <VShortcutLabel accelerator="<Control>s" disabled-text="No shortcut" />
            <VShortcutLabel accelerator="<Control><Shift>q" disabled-text="No shortcut" />
          </VBox>
        </VFrame>
      </VBox>

      <VFrame label="Popovers">
        <VBox orientation="horizontal" :spacing="12">
          <VMenuButton>
            <VLabel>Emoji</VLabel>
            <template #popover>
              <VEmojiChooser @emoji-picked="emoji = $event" />
            </template>
          </VMenuButton>
          <VPopoverBin>
            <VButton>PopoverBin child</VButton>
            <template #popover>
              <VPopover>
                <VLabel>Popover from #popover</VLabel>
              </VPopover>
            </template>
          </VPopoverBin>
          <VLabel class="value">picked {{ emoji }}</VLabel>
        </VBox>
      </VFrame>

      <VBox orientation="horizontal" :spacing="14">
        <VFrame label="VTreeExpander" :hexpand="true">
          <VTreeExpander :indent-for-icon="true" :indent-for-depth="true">
            <VLabel>Row content</VLabel>
          </VTreeExpander>
        </VFrame>

        <VFrame label="VSvgWidget" :hexpand="true">
          <VSvgWidget :bytes="svgBytes" :height-request="72" />
        </VFrame>
      </VBox>

      <VFrame label="Custom titlebar widgets">
        <VBox :spacing="8">
          <VWindowHandle>
            <VLabel>VWindowHandle wraps draggable content</VLabel>
          </VWindowHandle>
          <VBox orientation="horizontal" :spacing="12">
            <VWindowControls
              side="end"
              decoration-layout="icon:close"
              :use-native-controls="false"
            />
            <VLabel class="value">VWindowControls side=end</VLabel>
          </VBox>
        </VBox>
      </VFrame>

      <VFrame label="VGraphicsOffload">
        <VGraphicsOffload enabled="disabled" :black-background="true">
          <VLabel>Offload child (disabled in this demo)</VLabel>
        </VGraphicsOffload>
      </VFrame>

      <VLabel class="hint">{{ notes.join(" ") }}</VLabel>
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading {
  font-size: 20px;
}

.value {
  opacity: 0.8;
}

.hint {
  opacity: 0.7;
}
</style>

<style>
/* GTK 4.24.1 on this host reports a negative minimum slider size for a standalone
   scrollbar unless the theme provides a concrete min-size. */
scrollbar slider {
  min-width: 8px;
  min-height: 8px;
}
</style>
