import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

test("the production shell restores its replica offline and locks expired offline access without deleting it", async ({
    page,
    context,
}) => {
    test.skip(!process.env.CI, "Requires the production service worker");
    await page.goto("/");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbark.example");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    await page.evaluate(() => {
        localStorage.setItem("cb_verified_at", String(Date.now() - 8 * 86_400_000));
    });
    await page.reload();
    await expect(page.getByText(strings.sync.offlineExpired, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("cb_user"))).not.toBeNull();
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    const cached = await page.evaluate(async () => {
        const keys: string[] = [];
        for (const name of await caches.keys())
            for (const request of await (await caches.open(name)).keys())
                keys.push(new URL(request.url).pathname);
        return keys;
    });
    expect(cached).toContain("/index.html");
    expect(cached.every((path) => path === "/index.html" || path.startsWith("/assets/"))).toBe(
        true,
    );
});
