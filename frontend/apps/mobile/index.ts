import "./src/polyfills";

import { setPseudoLocale } from "@clientbridge/app-core";
import { registerRootComponent } from "expo";
import { App } from "./App";
import { pseudoLocale } from "./src/lib/config";

// The bundled en-XA catalog loads within the same tick, before the first render.
if (pseudoLocale) setPseudoLocale(true).catch(() => undefined);
registerRootComponent(App);
