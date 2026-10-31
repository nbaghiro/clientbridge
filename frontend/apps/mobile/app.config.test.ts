import { existsSync, readFileSync } from "node:fs";

import { theme } from "@clientbridge/tokens/native";
import type { ExpoConfig } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vitest";

const STAGING = {
    APP_ID: "ca.clientbridge.app.staging",
    APP_NAME: "Clientbridge Staging",
    BASE_DOMAIN: "staging.clientbridge.ca",
};

async function load(env: Record<string, string>): Promise<ExpoConfig> {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return (await import("./app.config")).default;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("app config", () => {
    it("embeds every face of the theme's fonts", async () => {
        const { FONT_FAMILIES } = await import("./app.config");
        expect(FONT_FAMILIES.map((f) => f.fontFamily)).toEqual([theme.fonts.ui, theme.fonts.mono]);
        for (const { path } of FONT_FAMILIES.flatMap((f) => f.fontDefinitions)) {
            expect(existsSync(require.resolve(path))).toBe(true);
        }
    });

    it("keeps local builds on the local app id, hosts and no updates", async () => {
        const config = await load({});
        expect(config.ios?.bundleIdentifier).toBe("ca.clientbridge.app");
        expect(config.android?.package).toBe("ca.clientbridge.app");
        expect(config.updates?.enabled).toBe(false);
        expect(config.ios?.associatedDomains).toBeUndefined();
        expect(config.extra?.apiUrl).toBe("http://127.0.0.1:8701");
    });

    it("builds a deployed environment from its EAS variables", async () => {
        const config = await load(STAGING);
        expect(config.name).toBe("Clientbridge Staging");
        expect(config.ios?.bundleIdentifier).toBe(STAGING.APP_ID);
        expect(config.android?.package).toBe(STAGING.APP_ID);
        expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
        expect(config.updates?.enabled).toBe(true);
        expect(config.updates?.url).toMatch(/^https:\/\/u\.expo\.dev\/[0-9a-f-]{36}$/);
        expect(config.ios?.associatedDomains).toEqual([
            "webcredentials:app.staging.clientbridge.ca",
        ]);
        expect(config.extra).toMatchObject({
            apiUrl: "https://api.staging.clientbridge.ca",
            authUrl: "https://api.staging.clientbridge.ca/auth",
            powersyncUrl: "https://sync.staging.clientbridge.ca",
            pageUrl: "https://{slug}.staging.clientbridge.ca",
            bookUrl: "https://book.staging.clientbridge.ca",
            shopUrl: "https://shop.staging.clientbridge.ca",
            payUrl: "https://pay.staging.clientbridge.ca",
        });
        expect(config.ios?.entitlements).toEqual({});
    });

    it("gives the native e2e build its own app id without deployed updates", async () => {
        const config = await load({ APP_ID: "ca.clientbridge.app.e2e" });
        expect(config.ios?.bundleIdentifier).toBe("ca.clientbridge.app.e2e");
        expect(config.android?.package).toBe("ca.clientbridge.app.e2e");
        expect(config.updates?.enabled).toBe(false);
    });

    it("adds the Tap to Pay entitlement only when the environment has it", async () => {
        const config = await load({ ...STAGING, TAP_TO_PAY: "true" });
        expect(config.ios?.entitlements).toEqual({
            "com.apple.developer.proximity-reader.payment.acceptance": true,
        });
    });

    it("refuses a deployed build profile without its environment", async () => {
        await expect(load({ EAS_BUILD_PROFILE: "staging" })).rejects.toThrow(/APP_ID/);
    });

    it("gives each build profile its channel and EAS environment, and no build-only variables", () => {
        const eas = JSON.parse(readFileSync(new URL("eas.json", import.meta.url), "utf8")) as {
            build: Record<string, { channel?: string; environment?: string; env?: unknown }>;
        };
        expect(Object.keys(eas.build)).toEqual(["staging", "production"]);
        for (const [name, profile] of Object.entries(eas.build)) {
            expect(profile.channel).toBe(name);
            expect(profile.environment).toBe(name === "staging" ? "preview" : "production");
            // an update reads only the EAS environment, so a build-only value would split runtimes
            expect(profile.env).toBeUndefined();
        }
    });
});
