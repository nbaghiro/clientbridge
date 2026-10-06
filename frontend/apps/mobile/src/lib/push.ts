import { type DevicePlatform, registerDevice } from "@clientbridge/app-core";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";
import { easProjectId } from "./config";

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
        const token = (
            await Notifications.getExpoPushTokenAsync(
                easProjectId ? { projectId: easProjectId } : undefined,
            )
        ).data;
        await registerDevice(api, token, devicePlatform());
    } catch {
        // Best-effort: denied permission, Expo Go or a network error must never block app start.
    }
}
