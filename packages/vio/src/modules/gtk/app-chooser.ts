import Gtk from "gi:Gtk-4.0";
import Gio from "gi:Gio-2.0";
import { defineComponent, h, shallowRef, watch, type PropType } from "@vue/runtime-core";
import type { VioElement } from "../renderer/index.ts";
import { getWidgetDefinition, hasWidget, registerWidget, type WidgetDefinition } from "./driver.ts";

type Attrs = Record<string, unknown>;

function useElement() {
  const element = shallowRef<VioElement | null>(null);
  const handle = {
    element,
    get widget() {
      return element.value?.widget ?? null;
    },
  };
  return { element, handle };
}

function define(type: string, definition: WidgetDefinition): WidgetDefinition {
  if (!hasWidget(type)) registerWidget(type, definition);
  const registered = getWidgetDefinition(type);
  if (!registered) throw new Error(`vio: failed to register '${type}'`);
  return registered;
}

/** RFC 6838-shaped check; `Gio.contentTypeFromMimeType()` is the native first pass. */
const mimeType = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

function contentTypeOf(value: string | undefined): { value: string | null; error: string | null } {
  if (value == null || value === "") return { value: null, error: "content-type is required" };
  let normalized: string | null;
  try {
    normalized = Gio.contentTypeFromMimeType(value);
  } catch (cause) {
    return {
      value: null,
      error: `invalid content type '${value}': ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (normalized == null || normalized === "" || !mimeType.test(normalized))
    return { value: null, error: `invalid content type '${value}'` };
  return { value: normalized, error: null };
}

define("vio-app-chooser-button", {
  create: (props) =>
    new Gtk.AppChooserButton({
      ...(props?.contentType == null ? {} : { contentType: String(props.contentType) }),
    }),
  constructProps: ["content-type"],
  children: "none",
});

export const VAppChooserButton = defineComponent({
  name: "VAppChooserButton",
  inheritAttrs: false,
  props: {
    contentType: { type: String as PropType<string>, required: true },
    heading: { type: String as PropType<string | undefined>, default: undefined },
    modal: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showDialogItem: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showDefaultItem: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["custom-item-activated", "activate"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const error = shallowRef<string | null>(contentTypeOf(props.contentType).error);
    const button = () =>
      element.value?.widget as InstanceType<typeof Gtk.AppChooserButton> | undefined;
    watch(
      () => props.contentType,
      (value) => {
        error.value = contentTypeOf(value).error;
      },
    );
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get contentType() {
        return button()?.getContentType() ?? null;
      },
      get heading() {
        return button()?.getHeading() ?? null;
      },
      get modal() {
        return button()?.getModal() ?? false;
      },
      get showDialogItem() {
        return button()?.getShowDialogItem() ?? false;
      },
      get showDefaultItem() {
        return button()?.getShowDefaultItem() ?? false;
      },
      get available() {
        return contentTypeOf(props.contentType).value != null;
      },
      error,
      /** `GtkAppChooserButton::append-separator()`, exposed because GTK has no property for it. */
      appendSeparator() {
        button()?.appendSeparator();
      },
      /** `GtkAppChooserButton::append-custom-item()`; `icon` must be a `Gio.Icon`. */
      appendCustomItem(name: string, label: string, icon: object) {
        button()?.appendCustomItem(name, label, icon as never);
      },
      activate() {
        button()?.activate();
      },
    });
    return () => {
      const content = contentTypeOf(props.contentType);
      return h("vio-app-chooser-button", {
        ...attrs,
        ref: element,
        ...(content.value == null ? {} : { contentType: content.value }),
        ...(props.heading === undefined ? {} : { heading: props.heading }),
        ...(props.modal === undefined ? {} : { modal: props.modal }),
        ...(props.showDialogItem === undefined ? {} : { showDialogItem: props.showDialogItem }),
        ...(props.showDefaultItem === undefined ? {} : { showDefaultItem: props.showDefaultItem }),
        onCustomItemActivated: (name: unknown) => emit("custom-item-activated", String(name)),
        onActivate: () => emit("activate"),
      });
    };
  },
});

define("vio-app-chooser-widget", {
  create: (props) =>
    new Gtk.AppChooserWidget({
      ...(props?.contentType == null ? {} : { contentType: String(props.contentType) }),
    }),
  constructProps: ["content-type"],
  children: "none",
});

export const VAppChooserWidget = defineComponent({
  name: "VAppChooserWidget",
  inheritAttrs: false,
  props: {
    contentType: { type: String as PropType<string>, required: true },
    showDefault: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showFallback: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showOther: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showRecommended: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    showAll: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  },
  emits: ["application-selected", "application-activated"],
  setup(props, { attrs, expose, emit }) {
    const { element, handle } = useElement();
    const error = shallowRef<string | null>(contentTypeOf(props.contentType).error);
    const chooser = () =>
      element.value?.widget as InstanceType<typeof Gtk.AppChooserWidget> | undefined;
    watch(
      () => props.contentType,
      (value) => {
        error.value = contentTypeOf(value).error;
      },
    );
    expose({
      element: handle.element,
      get widget() {
        return handle.widget;
      },
      get contentType() {
        return chooser()?.getContentType() ?? null;
      },
      get showDefault() {
        return chooser()?.getShowDefault() ?? false;
      },
      get showFallback() {
        return chooser()?.getShowFallback() ?? false;
      },
      get showOther() {
        return chooser()?.getShowOther() ?? false;
      },
      get showRecommended() {
        return chooser()?.getShowRecommended() ?? false;
      },
      get showAll() {
        return chooser()?.getShowAll() ?? false;
      },
      get available() {
        return contentTypeOf(props.contentType).value != null;
      },
      error,
    });
    return () => {
      const content = contentTypeOf(props.contentType);
      return h("vio-app-chooser-widget", {
        ...attrs,
        ref: element,
        ...(content.value == null ? {} : { contentType: content.value }),
        ...(props.showDefault === undefined ? {} : { showDefault: props.showDefault }),
        ...(props.showFallback === undefined ? {} : { showFallback: props.showFallback }),
        ...(props.showOther === undefined ? {} : { showOther: props.showOther }),
        ...(props.showRecommended === undefined ? {} : { showRecommended: props.showRecommended }),
        ...(props.showAll === undefined ? {} : { showAll: props.showAll }),
        onApplicationSelected: (app: unknown) => emit("application-selected", app),
        onApplicationActivated: (app: unknown) => emit("application-activated", app),
      });
    };
  },
});
