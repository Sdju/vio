<script setup lang="ts">
import {
  ref,
  VAboutDialog,
  VAlertDialog,
  VBox,
  VButton,
  VDialog,
  VLabel,
  VWindow,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();

const windowRef = ref();
const alertRef = ref();
const showDialog = ref(false);
const showAbout = ref(false);
const response = ref("No dialog opened yet");

function close() {
  props.quit();
  return true;
}

function closeAbout() {
  showAbout.value = false;
  return true;
}

function dialogResponded(id: string | number) {
  response.value = `Dialog response: ${String(id)}`;
}

async function ask() {
  const choice = await alertRef.value.choose(windowRef.value);
  response.value = choice == null ? "Alert cancelled" : `Alert response: ${choice}`;
}
</script>

<template>
  <VWindow
    ref="windowRef"
    title="vio · dialogs"
    :default-width="440"
    :default-height="300"
    :visible="true"
    @close-request="close"
  >
    <VBox
      orientation="vertical"
      :spacing="12"
      :margin-top="24"
      :margin-bottom="24"
      :margin-start="24"
      :margin-end="24"
    >
      <VLabel class="heading">Windows and dialogs</VLabel>
      <VLabel>{{ response }}</VLabel>
      <VButton @clicked="showDialog = true">Open VDialog</VButton>
      <VButton @clicked="showAbout = true">Open VAboutDialog</VButton>
      <VButton @clicked="ask">Ask VAlertDialog</VButton>
      <VButton @clicked="props.quit()">Quit</VButton>
    </VBox>
  </VWindow>

  <VDialog
    v-model:visible="showDialog"
    title="Declaration dialog"
    :buttons="[
      { id: 'ok', label: 'OK', default: true, suggested: true },
      { id: 'cancel', label: 'Cancel' },
    ]"
    @response="dialogResponded"
  >
    <VBox :spacing="8" :margin-top="16" :margin-bottom="16" :margin-start="16" :margin-end="16">
      <VLabel>#content is placed in GtkDialog's content area.</VLabel>
      <VLabel>Buttons are declarative; string ids come back from @response.</VLabel>
    </VBox>
  </VDialog>

  <VAboutDialog
    :visible="showAbout"
    program-name="vio"
    version="0.7.1"
    comments="Dialogs and windows for the Vue GTK renderer."
    copyright="MIT"
    license-type="mit-x11"
    logo="dialog-information"
    website="https://github.com/Sdju/vio"
    website-label="Project"
    :authors="['vio contributors']"
    @close-request="closeAbout"
  />

  <VAlertDialog
    ref="alertRef"
    message="Continue with wave 3?"
    detail="The answer is returned as a Promise and cancellation resolves to null."
    :buttons="['Cancel', 'Continue']"
    :cancel-button="0"
    :default-button="1"
  />
</template>

<style scoped>
.heading {
  font-size: 20px;
}
</style>
