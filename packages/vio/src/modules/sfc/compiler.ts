import {
  parse,
  compileScript,
  compileStyle,
  compileTemplate,
  type CompilerOptions,
} from "@vue/compiler-sfc";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";

/** `v-model` is only valid on components that declare the matching prop and update event. */
const modelComponents = new Set([
  "VEntry",
  "VToggleButton",
  "VExpander",
  "VProgressBar",
  "VLevelBar",
  "VScale",
  "VSpinButton",
  "VDropDown",
  "VComboBoxText",
  "VPasswordEntry",
  "VTextView",
  "VEditableLabel",
  "VSearchEntry",
  "VColumnView",
  "VGridView",
  "VIconView",
  "VDialog",
]);

/** `gtk-*` tags are native elements, not components that Vue must resolve. */
const isCustomElement = (tag: string) => tag.startsWith("gtk-");

/** Compile SFCs for runtime-core rather than the DOM compiler/runtime. */
export function compileSfc(source: string, filename: string): string {
  const { descriptor, errors } = parse(source, {
    filename,
    // The descriptor AST is reused by inline `<script setup>` compilation, so the parser must
    // already classify `gtk-*` tags as elements instead of components.
    templateParseOptions: { isCustomElement },
  });
  if (errors.length) throw new Error(`vio: ${filename}: ${errors.map(String).join("\n")}`);
  if (
    descriptor.template?.src ||
    descriptor.script?.src ||
    descriptor.scriptSetup?.src ||
    descriptor.styles.some((style) => style.src)
  ) {
    throw new Error(
      "vio: external SFC blocks are not supported; import a component or CSS module instead",
    );
  }
  if (descriptor.template?.lang && descriptor.template.lang !== "html")
    throw new Error("vio: templates must use HTML syntax");
  if (descriptor.styles.some((style) => style.lang && style.lang !== "css"))
    throw new Error("vio: styles must use GTK CSS");
  const id = `vio-${createHash("sha256").update(filename).digest("hex").slice(0, 10)}`;
  // compileScript requires at least one script block, even for template-only components.
  if (!descriptor.script && !descriptor.scriptSetup) {
    if (!descriptor.template) throw new Error("vio: an SFC needs a template or script");
    descriptor.script = {
      type: "script",
      content: "export default {}",
      loc: descriptor.template.loc,
      attrs: {},
    };
  }
  const compilerOptions: CompilerOptions = {
    runtimeModuleName: "@zede/vio",
    hoistStatic: false,
    isCustomElement,
    nodeTransforms: [
      (node) => {
        if (node.type !== 1) return;
        for (const prop of node.props) {
          if (prop.type !== 7) continue;
          if (["html", "text"].includes(prop.name))
            throw new Error(`vio: v-${prop.name} is a DOM directive; use VLabel interpolation`);
          if (prop.name === "model" && !modelComponents.has(node.tag))
            throw new Error(
              "vio: v-model is supported on VEntry and the V* control components; use GTK properties/signals for native widgets",
            );
          if (prop.name === "on" && prop.modifiers.some((modifier) => modifier.content !== "once"))
            throw new Error(
              "vio: DOM event modifiers are not supported; GTK event handlers return true to consume an event",
            );
        }
      },
    ],
  };
  const script = compileScript(descriptor, {
    id,
    genDefaultAs: "__vio_component",
    inlineTemplate: true,
    fs: {
      fileExists: existsSync,
      readFile: (filename) => readFileSync(filename, "utf8"),
      realpath: realpathSync,
    },
    templateOptions: {
      compilerOptions,
    },
  });
  const styles = descriptor.styles
    .map((style) => {
      const result = compileStyle({ source: style.content, filename, id, scoped: style.scoped });
      if (result.errors.length)
        throw new Error(`vio: ${filename}: ${result.errors.map(String).join("\n")}`);
      // GTK has CSS classes but no DOM data-* attributes.
      return result.code.replaceAll(`[${id}]`, `.${id}`).replaceAll(`[data-v-${id}]`, `.${id}`);
    })
    .join("\n");
  let code = script.content.replace(/from\s*(['"])vue\1/g, 'from "@zede/vio"');
  if (!descriptor.scriptSetup && descriptor.template) {
    const result = compileTemplate({
      source: descriptor.template.content,
      filename,
      id,
      compilerOptions: { ...compilerOptions, bindingMetadata: script.bindings },
    });
    if (result.errors.length)
      throw new Error(`vio: ${filename}: ${result.errors.map(String).join("\n")}`);
    code += `\n${result.code.replace("export function render", "function __vio_render")}\n__vio_component.render = __vio_render;\n`;
  }
  if (styles)
    code += `\nimport { withStyles as __vio_withStyles } from '@zede/vio';\nexport default __vio_withStyles(__vio_component, ${JSON.stringify(styles)}, ${descriptor.styles.some((style) => style.scoped) ? JSON.stringify(id) : "undefined"});\n`;
  else code += "\nexport default __vio_component;\n";
  return descriptor.script?.lang === "ts" || descriptor.scriptSetup?.lang === "ts"
    ? stripTypeScriptTypes(code)
    : code;
}
