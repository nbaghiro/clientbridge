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

const { currentUserId, endHeldSession, forgetSession, holdSession, rememberUser, signIn } =
    await import("./auth");

describe("a sign-in the app was killed during", () => {
    beforeEach(() => {
        keychain.clear();
    });

    it("is ended at the next launch, once", async () => {
        holdSession("half-finished");
        const end = vi.fn(() => Promise.resolve());
        await endHeldSession(end);
        expect(end).toHaveBeenCalledWith("half-finished");
        await endHeldSession(end);
        expect(end).toHaveBeenCalledTimes(1);
    });

    it("leaves nothing to end once it finished", async () => {
        holdSession("half-finished");
        holdSession(null);
        const end = vi.fn(() => Promise.resolve());
        await endHeldSession(end);
        expect(end).not.toHaveBeenCalled();
    });

    it("stays for the next launch while offline", async () => {
        holdSession("half-finished");
        await expect(endHeldSession(() => Promise.reject(new Error("offline")))).rejects.toThrow();
        const end = vi.fn(() => Promise.resolve());
        await endHeldSession(end);
        expect(end).toHaveBeenCalledWith("half-finished");
    });

    it("keeps a newer sign-in's token while ending the old one", async () => {
        holdSession("old");
        await endHeldSession(() => {
            holdSession("new");
            return Promise.resolve();
        });
        const end = vi.fn(() => Promise.resolve());
        await endHeldSession(end);
        expect(end).toHaveBeenCalledWith("new");
    });
});

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
