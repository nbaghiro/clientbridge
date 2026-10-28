import "./src/polyfills";

import { setDeviceZone, setMediaBase, setPseudoLocale } from "@clientbridge/app-core";
import { registerRootComponent } from "expo";
import { getCalendars } from "expo-localization";
import { OrientationLock, lockAsync } from "expo-screen-orientation";
import { App } from "./App";
import { apiUrl, pseudoLocale } from "./src/lib/config";
import { isTablet } from "./src/lib/device";

if (!isTablet) lockAsync(OrientationLock.PORTRAIT_UP).catch(() => undefined);
setDeviceZone(getCalendars()[0].timeZone ?? "UTC");
setMediaBase(apiUrl);
// The bundled en-XA catalog loads within the same tick, before the first render.
if (pseudoLocale) setPseudoLocale(true).catch(() => undefined);
registerRootComponent(App);
