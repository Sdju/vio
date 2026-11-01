import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp } from "@zede/vio";
import { Dialogs } from "../modules/dialogs/index.ts";

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const app = createApp(Dialogs, {
  quit: () => {
    app.unmount();
    loop.quit();
  },
});
app.mount();
loop.run();
