<script setup lang="ts">
import { ref } from "@zede/vio";
import {
  VButton,
  VCenterBox,
  VFlowBox,
  VHeaderBar,
  VLabel,
  VListModel,
  VListView,
  VNotebook,
  VNotebookPage,
  VOverlay,
  VPaned,
  VWindow,
} from "@zede/vio";

const props = defineProps<{ quit: () => void }>();
const items = ref(["alpha", "beta", "gamma"]);
const badges = ref(["alpha", "beta", "gamma"]);
const model = ref<{ selection?: object; factory?: object }>();

const headerActions = ref([
  { id: "add", label: "Добавить", run: addItem },
  { id: "reorder", label: "Порядок", run: reorderHeader },
  { id: "clear", label: "Очистить", run: clearItems },
]);

function addItem() {
  items.value = [...items.value, `item ${items.value.length + 1}`];
}
function clearItems() {
  items.value = [];
}
function reorderHeader() {
  const [first, ...rest] = headerActions.value;
  if (first) headerActions.value = [...rest, first];
}
function addBadge() {
  badges.value = [...badges.value, `badge ${badges.value.length + 1}`];
}
function removeBadge() {
  badges.value = badges.value.slice(1);
}
function close() {
  props.quit();
  return true;
}
</script>

<template>
  <VWindow
    title="vio · declarative containers"
    :default-width="900"
    :default-height="560"
    :visible="true"
    @close-request="close"
  >
    <VHeaderBar role="titlebar">
      <template #start>
        <VButton v-for="action in headerActions" :key="action.id" @clicked="action.run()">
          {{ action.label }}
        </VButton>
      </template>
      <template #title>
        <VLabel>VNotebook · VPaned · VOverlay ×N · VListModel</VLabel>
      </template>
      <template #end>
        <VButton @clicked="addBadge">Бейдж +</VButton>
        <VButton @clicked="removeBadge">Бейдж −</VButton>
      </template>
    </VHeaderBar>

    <VPaned>
      <template #start>
        <VNotebook>
          <VNotebookPage label="ListView">
            <VListModel ref="model" :items="items" :selected="0" />
            <VListView
              :model="model?.selection"
              :factory="model?.factory"
              :vexpand="true"
              :margin-top="12"
              :margin-bottom="12"
              :margin-start="12"
              :margin-end="12"
            />
          </VNotebookPage>
          <VNotebookPage label="FlowBox">
            <VFlowBox :margin-top="12" :margin-start="12" :margin-end="12">
              <VLabel v-for="item in items" :key="item">{{ item }}</VLabel>
            </VFlowBox>
          </VNotebookPage>
          <VNotebookPage label="Слот таба">
            <VLabel>Вкладка с собственным виджетом заголовка</VLabel>
            <template #tab-label>
              <VLabel>tab widget</VLabel>
            </template>
          </VNotebookPage>
        </VNotebook>
      </template>

      <template #end>
        <VOverlay>
          <VCenterBox :margin-top="24" :margin-start="24" :margin-end="24">
            <template #start>
              <VLabel>start</VLabel>
            </template>
            <template #center>
              <VLabel>main child</VLabel>
            </template>
            <template #end>
              <VLabel>end</VLabel>
            </template>
          </VCenterBox>
          <template #overlay>
            <VLabel
              v-for="(badge, index) in badges"
              :key="badge"
              class="badge"
              :halign="'end'"
              :valign="'start'"
              :margin-top="12 + index * 34"
              :margin-end="12"
            >
              {{ badge }}
            </VLabel>
          </template>
        </VOverlay>
      </template>
    </VPaned>
  </VWindow>
</template>

<style scoped>
.badge {
  background-color: rgba(53, 132, 228, 0.35);
  border-radius: 12px;
  padding: 4px 10px;
}
</style>
