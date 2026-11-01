import { beforeEach, describe, expect, it, vi } from "vitest";

const keychain = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
    getItemAsync: (key: string) => Promise.resolve(keychain.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
        keychain.set(key, value);
        return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
        keychain.delete(key);
        return Promise.resolve();
    },
}));
vi.mock("@clientbridge/app-core", () => ({ useCurrentViewer: () => null }));

const { currentUserId, forgetSession, rememberUser, signIn } = await import("./auth");

describe("the signed-in user", () => {
    beforeEach(async () => {
        keychain.clear();
        await forgetSession();
    });

    it("is known in memory once remembered, so a screen mounted later starts with it", async () => {
        await signIn("token-a");
        expect(currentUserId()).toBeNull();
        await rememberUser("us_owner");
        expect(currentUserId()).toBe("us_owner");
    });

    it("is cleared by a new sign-in and by forgetting the session", async () => {
        await signIn("token-a");
        await rememberUser("us_owner");
        await signIn("token-b");
        expect(currentUserId()).toBeNull();
        await rememberUser("us_staff");
        await forgetSession();
        expect(currentUserId()).toBeNull();
    });

    it("is not remembered without a stored session", async () => {
        await rememberUser("us_owner");
        expect(currentUserId()).toBeNull();
    });
});
