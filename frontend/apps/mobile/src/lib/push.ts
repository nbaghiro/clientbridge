import { type DevicePlatform, registerDevice } from "@clientbridge/app-core";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";

Notifications.setNotificationHandler({
    handleNotification: () =>
        Promise.resolve({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
        }),
});

function devicePlatform(): DevicePlatform {
    if (Platform.OS === "ios") return "ios";
    if (Platform.OS === "android") return "android";
    return "web";
}

/** Best-effort Expo push registration — never throws (push setup must not block app start). */
export async function registerForPush(): Promise<void> {
    try {
        const { granted } = await Notifications.requestPermissionsAsync();
        if (!granted) return;
        const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
        const projectId = extra.eas?.projectId;
        const token = (
            await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
        ).data;
        await registerDevice(api, token, devicePlatform());
    } catch {
        // Best-effort: permission denied, Expo Go (SDK 53+ dropped remote push), or a transient
        // network error must never break app start.
    }
}
