# vio

Vue custom renderer для GTK4 на Node.js. Компоненты, реактивность, `v-for`, `v-if`, slots и lifecycle выполняет Vue; дерево виджетов и сигналы обслуживает GTK. DOM, WebView и Chromium для нативного интерфейса не используются.

## Быстрый старт

Нужны Node.js 24+, GTK4 и GObject Introspection. Установите `@zede/vio` и его peer dependency `node-gtk`. Внешний проект устанавливает пакет командой `npm install @zede/vio node-gtk`. В этом репозитории зависимости устанавливаются командой `vp install --frozen-lockfile`.

```vue
<!-- Counter.vue -->
<script setup lang="ts">
import { ref, VWindow, VBox, VEntry, VLabel, VButton } from "@zede/vio";
const name = ref("Vue + GTK");
const count = ref(0);
defineProps<{ quit: () => void }>();
</script>

<template>
  <VWindow title="vio" :visible="true" @close-request="quit">
    <VBox orientation="vertical" :spacing="12" :margin-top="24">
      <VEntry v-model="name" />
      <VLabel>{{ name }} · {{ count }}</VLabel>
      <VButton @clicked="count++">Увеличить</VButton>
    </VBox>
  </VWindow>
</template>

<style scoped>
label {
  font-size: 22px;
}
</style>
```

```ts
// main.ts
import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp } from "@zede/vio";
import Counter from "./Counter.vue";

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const app = createApp(Counter, {
  quit: () => {
    app.unmount();
    loop.quit();
    return true;
  },
});
app.mount();
loop.run();
```

```bash
node --import @zede/vio/register main.ts
```

`@zede/vio/register` регистрирует и `.vue`, и `gi:` imports. SFC компилируется один раз при импорте, с inline render function для `@vue/runtime-core`. Для TS используется встроенное удаление типов Node; в Node 24 вызов этого API может печатать ExperimentalWarning. Runtime-only приложения могут использовать `h()` и загрузчик `node-gtk/register` без SFC-компилятора.

## Компоненты и свойства

| Компонент                                           | GTK                                     |
| --------------------------------------------------- | --------------------------------------- |
| `VWindow`, `VBox`, `VGrid`, `VStack`                | Window, Box, Grid, Stack                |
| `VEntry`, `VLabel`, `VButton`, `VImage`             | Entry, Label, Button, Image             |
| `VListBox`, `VListBoxRow`, `VScrolledWindow`        | ListBox, ListBoxRow, ScrolledWindow     |
| `VSeparator`, `VSpinner`, `VSwitch`, `VCheckButton` | Separator, Spinner, Switch, CheckButton |
| `VNotebook`, `VNotebookPage`                        | Notebook, страница с tab label          |
| `VPaned`, `VOverlay`, `VCenterBox`, `VHeaderBar`    | Paned, Overlay, CenterBox, HeaderBar    |
| `VFlowBox`, `VFixed`                                | FlowBox, Fixed                          |
| `VListView`, `VListModel`                           | ListView + модель/factory как ресурс    |
| `VKeyController`                                    | EventControllerKey                      |

Атрибуты соответствуют GObject properties. Принимаются camelCase и kebab-case: `:margin-top="16"`, `:hexpand="true"`, `:sensitive="!busy"`. Числа и boolean передавайте через `:`. `id` устанавливает GTK widget name. `class` поддерживает строку, массив и объект Vue; удаление binding восстанавливает исходные свойства и классы GTK.

Enum props можно передавать строками: `orientation="vertical"`, `selection-mode="single"`, `ellipsize="end"`, `propagation-phase="capture"`, `halign="center"`. Для других enum/flags передавайте значение импортированного GI namespace.

`VListBox` принимает `selected` — индекс строки; `-1` снимает выбор. Его непосредственные виджеты должны быть `VListBoxRow`. У Window, Button, Row и ScrolledWindow один widget child: несколько соседних виджетов оборачиваются в `VBox`. Event controller не занимает это место. Для детей `VGrid` доступны `row`, `column`, `row-span`, `column-span`; страницы `VStack` именуются через `name`.

## Контейнеры и роли

`VNotebook`, `VPaned`, `VOverlay`, `VCenterBox`, `VHeaderBar`, `VFlowBox` и `VFixed` размещают содержимое декларативно, через именованные слоты и роль `role`. Дочерние виджеты не нужно создавать вручную:

```vue
<VWindow>
  <VHeaderBar role="titlebar">
    <template #title><VLabel>vio</VLabel></template>
  </VHeaderBar>
  <VPaned>
    <template #start>
      <VNotebook>
        <VNotebookPage label="One">…</VNotebookPage>
        <VNotebookPage v-for="item in items" :key="item.id" :label="item.title">…</VNotebookPage>
      </VNotebook>
    </template>
    <template #end>
      <VOverlay>
        <VLabel>main</VLabel>
        <template #overlay><VLabel>overlay</VLabel></template>
      </VOverlay>
    </template>
  </VPaned>
</VWindow>
```

`VNotebookPage` принимает строковый `label` или слот `#tab-label` с произвольным виджетом заголовка. `VPaned` использует `#start`/`#end`, `VCenterBox` — `#start`/`#center`/`#end`, `VHeaderBar` — `#start`/`#end`/`#title`. `VHeaderBar role="titlebar"` должен быть прямым ребёнком `VWindow`: драйвер вызывает `setTitlebar()` и не занимает единственный content-слот окна. `VFixed` читает `x`/`y` из props ребёнка, `VFlowBox` сохраняет identity содержимого при keyed-переупорядочивании.

Компоненты контейнеров и хелперы `useNative`, `useDetachedSlot`, `defineContainerComponent` экспортируются из `@zede/vio`. Полное описание: `docs/containers.md` репозитория.

Также доступны raw элементы `<gtk-box>`, `<gtk-label>` и другие зарегистрированные `gtk-*` tags. Они используют тот же renderer.

Любой другой класс Gtk резолвится из GObject Introspection без `registerWidget()`: `<gtk-calendar>`, `<gtk-frame>`, `<gtk-level-bar :value="0.65">`, `<gtk-popover-menu :menu-model="menu">`. Явные регистрации имеют приоритет; режим детей интроспектированного контейнера задаёт явная таблица (`single` только для `frame`, `aspect-frame`, `expander`, `revealer`, `viewport`, `search-bar`, `dialog`, `message-dialog`, `about-dialog`, `application-window`, `shortcuts-window`; остальные — `none`). Покрытие: `listIntrospectedWidgetTypes()` и `getWidgetTypes()`. Правила, таблица режимов и работа с `ref`: [`docs/widgets.md`](../../docs/widgets.md).

## Сигналы, модель и refs

`@clicked`, `@changed`, `@row-activated`, `@close-request`, `@notify::is-active` соответствуют GTK signals. В обработчик передаются аргументы сигнала; callback может вернуть `true`, чтобы поглотить GTK-событие. `.once` поддерживается. Renderer обновляет callback без повторного подключения и отключает сигналы при unmount; ошибки передаются в Vue `app.config.errorHandler`.

`VEntry` поддерживает `v-model` через `text` / `changed`. Программное обновление свойства не вызывает обратный model-update. Для Switch и CheckButton используйте `:active` с `@notify::active` / `@toggled`.

Модели, фабрики, файлы и меню — это значения свойств, а не виджеты. Передавайте их через props: `:model`, `:factory`, `:file`, `:menu-model`. Нативные GObject нельзя держать в глубоком `ref()` — node-gtk отвергает Vue Proxy; используйте `shallowRef` или `useNative()`:

```ts
import { useNative } from "@zede/vio";
const model = useNative<Gtk.SingleSelection>();
const factory = useNative<Gtk.SignalListItemFactory>();
```

`VListView` принимает `SelectionModel` (оберните `Gio.ListStore` в `Gtk.SingleSelection`/`Gtk.MultiSelection`/`Gtk.NoSelection`) и `Gtk.SignalListItemFactory`. `VListModel` создаёт store, selection и factory сам и рендерит `null`:

```vue
<VListModel ref="model" :items="items" :selected="0" />
<VListView :model="model?.selection" :factory="model?.factory" :vexpand="true" />
```

Снятие binding `:model`/`:factory`/`:file`/`:menu-model` очищает свойство через dedicated setter (`setModel(null)` и т. п.); `setProperty(name, null)` для объектов node-gtk не принимает. `VListModel` синхронизирует store с массивом `items`, поэтому добавление, удаление и переупорядочивание элементов работают реактивно.

Ref компонента открывает `.element` — host node и `.widget` — реальный GTK объект:

```ts
import { ref, type WidgetHandle, type EntryWidget } from "@zede/vio";
const search = ref<WidgetHandle<EntryWidget>>();
search.value?.widget?.grabFocus();
```

```vue
<VEntry ref="search" v-model="query" />
```

Для императивного кода доступны структурные типы `Widget`, `WindowWidget`, `EntryWidget`, `RowWidget`, `ListBoxWidget`, `ButtonWidget`, `LabelWidget`, `ToggleWidget`. Публичные декларации не зависят от `.gir` файлов пользовательской машины. Gtk.Window.isActive() объявлен как метод с учётом особенностей node-gtk.

## CSS и расширение

`<style>` принимает GTK CSS. `<style scoped>` преобразует Vue scope attributes в GTK CSS classes. CSS provider живёт в scope компонента и удаляется при unmount. `class` и `style` bindings работают; inline style использует отдельный provider. Значения CSS должны быть допустимы для GTK, например `min-height: 44px`. Ошибки CSS не скрываются.

```ts
import Adw from "gi:Adw-1";
import { registerWidget, defineWidgetComponent } from "@zede/vio";

registerWidget("clamp", { create: () => new Adw.Clamp(), children: "single" });
export const VClamp = defineWidgetComponent("VClamp", "clamp");
```

`registerWidget()` валидирует `children` и отклоняет неизвестный режим. Для контейнеров с собственными слотами доступны хуки `insertChild`/`removeChild`; они получают `{ parent, parentWidget, child, node, role, before, index }`, где `role` — это `node.props.role`. Повторная вставка должна быть перемещением, а удаление — идемпотентным. `hasWidget(type)` и `getWidgetDefinition(type)` позволяют регистрировать тип один раз.

`createRoot(existingWidget, mode?)` встраивает Vue subtree в существующий GTK контейнер. `mode` — это `ChildrenMode` или имя зарегистрированного типа: без него драйвер распознаёт `Box`, `ListBox`, `Grid`, `Stack`, `Notebook`, `Paned`, `Overlay`, `CenterBox`, `HeaderBar`, `FlowBox` и `Fixed`. `createVioRenderer(driver)` из `@zede/vio/core` отделён от GI и используется в headless-тестах; `@zede/vio/core` не импортирует GTK.

## Границы первой версии

Поддерживаются Vue Composition/Options API, SFC, keyed lists, fragments, slots, component refs, lifecycle, `v-if`, `v-for`, `v-show` и `v-model` на VEntry. Здесь нет HTML layout engine: DOM directives (`v-html`, `v-text`), DOM event modifiers (`.prevent`, `.stop`), CSS preprocessors, external SFC blocks и browser transitions не поддерживаются. Для анимаций используются GTK API. Native HMR пока не реализован: после изменения `.vue` перезапустите нативный процесс.

## Разработка

Из корня [Sdju/vio](https://github.com/Sdju/vio):

```bash
vp run build
vp run test
vp run --filter @zede/vio demo
vp run --filter @zede/vio demo:showcase   # Notebook/Paned/Overlay + ListView
vp run test:gtk   # нужен доступ к desktop display
```

Пакет находится в pnpm workspace `packages/vio`; корневой пакет приватный. Manifest библиотеки содержит собственные зависимости, build и test scripts. Перед сборкой GTK-декларации генерируются локально в `node_modules/.node-gtk-types`; в tarball входят готовые ESM и `.d.mts` exports, README, лицензия и пример.

Основой служит официальный [Vue custom renderer API](https://vuejs.org/api/custom-renderer.html). Пакет состоит из независимого reconciler (`@zede/vio/core`), GTK driver, Vue widget components и SFC compiler/Node loader. В нём нет imports или настроек Projector.
