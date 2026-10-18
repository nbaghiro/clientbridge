import "./src/polyfills";

import { setDeviceZone, setMediaBase, setPseudoLocale } from "@clientbridge/app-core";
import { registerRootComponent } from "expo";
import { getCalendars } from "expo-localization";
import { App } from "./App";
import { apiUrl, pseudoLocale } from "./src/lib/config";

setDeviceZone(getCalendars()[0].timeZone ?? "UTC");
setMediaBase(apiUrl);
// The bundled en-XA catalog loads within the same tick, before the first render.
if (pseudoLocale) setPseudoLocale(true).catch(() => undefined);
registerRootComponent(App);
