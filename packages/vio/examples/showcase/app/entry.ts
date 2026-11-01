import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp } from "@zede/vio";
import { Showcase } from "../modules/showcase/index.ts";

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const app = createApp(Showcase, {
  quit: () => {
    app.unmount();
    loop.quit();
  },
});
app.mount();
loop.run();
