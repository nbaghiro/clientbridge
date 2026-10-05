import type { ApiLike } from "../api";

export type DevicePlatform = "ios" | "android" | "web";

export function registerDevice(
    api: ApiLike,
    token: string,
    platform: DevicePlatform,
): Promise<unknown> {
    return api.post("/v1/devices/register", { token, platform });
}
