/**
 * GTK's font and colour choosers log `GtkGizmo … (slider) reported min …` on the headless GTK
 * 4.22 CI runner even when the test installs the usual concrete slider CSS rule; see
 * `docs/limitations.md`. Drop exactly those lines and keep every other warning fatal.
 */
export function withoutSliderSizeWarnings(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter(
      (line) => !/\(slider\) reported min (?:width|height) -\d+, but sizes must be >= 0/.test(line),
    )
    .join("\n");
}
