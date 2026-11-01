import {
  onScopeDispose,
  type Component,
  type App,
  type ComponentPublicInstance,
  type ObjectDirective,
} from "@vue/runtime-core";
import { createRoot, createVioRenderer, type VioElement } from "../modules/renderer/index.ts";
import { gtkDriver, installCss } from "../modules/gtk/index.ts";
import type { Widget } from "../modules/renderer/index.ts";

export * from "@vue/runtime-core";
export {
  defineWidgetComponent,
  VWindow,
  VBox,
  VLabel,
  VButton,
  VImage,
  VListBox,
  VListBoxRow,
  VScrolledWindow,
  VGrid,
  VStack,
  VSeparator,
  VSpinner,
  VSwitch,
  VCheckButton,
  VKeyController,
  VEntry,
  VNotebook,
  VNotebookPage,
  VPaned,
  VOverlay,
  VCenterBox,
  VHeaderBar,
  VFlowBox,
  VFixed,
  VListView,
  VListModel,
  VToggleButton,
  VLinkButton,
  VMenuButton,
  VPopover,
  VPopoverMenu,
  VPopoverMenuBar,
  VExpander,
  VProgressBar,
  VLevelBar,
  VScale,
  VSpinButton,
  VDropDown,
  VComboBoxText,
  VPasswordEntry,
  VStackSwitcher,
  VStackSidebar,
  VColumnView,
  VColumnViewColumn,
  VGridView,
  VIconView,
  VTextView,
  VEditableLabel,
  VSearchEntry,
  VInscription,
  VSearchBar,
  VActionBar,
  VInfoBar,
  VStatusbar,
  VTreeView,
  VTreeViewColumn,
  VCellRendererText,
  VCellRendererToggle,
  VCellRendererPixbuf,
  createTreeListModel,
  VApplicationWindow,
  VAssistant,
  VAssistantPage,
  VDialog,
  VMessageDialog,
  VFileChooserDialog,
  VFileChooserNative,
  VColorChooserDialog,
  VFontChooserDialog,
  VAppChooserDialog,
  VAppChooserButton,
  VAppChooserWidget,
  VPrintUnixDialog,
  VPageSetupUnixDialog,
  VAboutDialog,
  VAlertDialog,
  VFileDialog,
  VColorDialog,
  VFontDialog,
  VPicture,
  VMediaFile,
  VVideo,
  VMediaControls,
  VDrawingArea,
  VGLArea,
  VColorButton,
  VFontButton,
  VColorDialogButton,
  VFontDialogButton,
  VCalendar,
  VStringList,
  VFilterListModel,
  VSortListModel,
  VFrame,
  VViewport,
  VRevealer,
  VAspectFrame,
  VScrollbar,
  VScaleButton,
  VVolumeButton,
  VLockButton,
  VPopoverBin,
  VEmojiChooser,
  VShortcutLabel,
  VTreeExpander,
  VSvgWidget,
  VWindowControls,
  VWindowHandle,
  VColorChooserWidget,
  VFontChooserWidget,
  VGraphicsOffload,
  toStringList,
  useStringList,
  useFilterListModel,
  useSortListModel,
  useSingleSelection,
  useMultiSelection,
  useNoSelection,
  nativeWindow,
  toFileFilters,
  type ResponseId,
  type DialogButton,
  type FileFilterInput,
  type FileFilterSpec,
  useListModel,
  defineContainerComponent,
  useDetachedSlot,
  useNative,
  type ContainerContext,
  type DetachedSlot,
  type ListModelHandle,
  type DrawingAreaDraw,
  type RgbaInput,
  type FontInput,
  type DateInput,
  type FilterListModelHandle,
  type SortListModelHandle,
  type SingleSelectionHandle,
  type MultiSelectionHandle,
  type NoSelectionHandle,
} from "../modules/gtk/index.ts";
export type {
  NativeObject,
  Widget,
  WindowWidget,
  EntryWidget,
  RowWidget,
  ListBoxWidget,
  ScrolledWidget,
  ButtonWidget,
  LabelWidget,
  ToggleWidget,
  WidgetHandle,
} from "../modules/renderer/index.ts";
export {
  createRoot,
  createVioRenderer,
  registerRoot,
  unregisterRoot,
  getRoot,
  getRootNames,
  queryRoot,
  type VioElement,
  type VioNode,
  type VioDriver,
} from "../modules/renderer/index.ts";
export {
  gtkDriver,
  registerWidget,
  hasWidget,
  getWidgetDefinition,
  getWidgetTypes,
  resolveIntrospected,
  listIntrospectedWidgetTypes,
  isIntrospectedType,
  installCss,
  type WidgetDefinition,
  type ChildrenMode,
  type Placement,
} from "../modules/gtk/index.ts";

const renderer = createVioRenderer(gtkDriver);
export const render = renderer.render;
export interface VioApp extends Omit<App<VioElement>, "mount"> {
  readonly root: VioElement;
  mount(root?: VioElement): ComponentPublicInstance;
}
export function createApp(
  component: Component,
  props: Record<string, unknown> | null = null,
): VioApp {
  const app = renderer.createApp(component, props);
  const mount = app.mount;
  const root = createRoot();
  Object.defineProperty(app, "root", { value: root });
  app.mount = (container = root) => mount(container);
  return app as VioApp;
}

/** CSS providers follow component scope lifetime, including repeated mount/unmount. */
export function useCss(css: string) {
  const dispose = installCss(css);
  onScopeDispose(dispose);
}
export function withStyles<T extends Component>(component: T, css: string, scopeId?: string): T {
  const options = component as { setup?: (...args: unknown[]) => unknown; __scopeId?: string };
  const setup = options.setup;
  // Vue uses setup.length to decide whether to create the expose/slots context.
  options.setup = function (props: unknown, context: unknown) {
    useCss(css);
    return setup?.(props, context);
  };
  if (scopeId) options.__scopeId = scopeId;
  return component;
}
export const vShow: ObjectDirective<VioElement, unknown> = {
  beforeMount: (node, binding) => (node.widget as Widget).setVisible(Boolean(binding.value)),
  updated: (node, binding) => (node.widget as Widget).setVisible(Boolean(binding.value)),
};
