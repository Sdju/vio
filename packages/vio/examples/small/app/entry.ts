import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp } from "@zede/vio";
import { Small } from "../modules/small/index.ts";

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const app = createApp(Small, {
  quit: () => {
    app.unmount();
    loop.quit();
  },
});
app.mount();
loop.run();
