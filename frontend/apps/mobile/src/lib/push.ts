import {
    type DevicePlatform,
    pushThread,
    registerDevice,
    unregisterDevice,
} from "@clientbridge/app-core";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
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

let registered: string | null = null;

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
        registered = token;
    } catch {
        // Best-effort: denied permission, Expo Go or a network error must never block app start.
    }
}

/** Stops pushes to this device on sign-out; best-effort, so signing out never waits on it. */
export async function unregisterFromPush(): Promise<void> {
    const token = registered;
    registered = null;
    if (token === null) return;
    try {
        await unregisterDevice(api, token);
    } catch {
        // The server prunes a device it has not seen in 60 days.
    }
}

/** Opens the conversation when a message push is tapped, including the tap that launched the app. */
export function usePushTaps(open: (threadId: string) => void): void {
    const response = Notifications.useLastNotificationResponse();
    useEffect(() => {
        if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        Notifications.clearLastNotificationResponse();
        const thread = pushThread(response.notification.request.content.data);
        if (thread !== null) open(thread);
    }, [response, open]);
}
