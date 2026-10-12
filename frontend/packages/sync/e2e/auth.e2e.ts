import { expect, test } from "@playwright/test";

test("browser tabs observe account replacement, bind replicas to their user and sign out", async ({
    page,
    context,
}) => {
    const second = await context.newPage();
    await page.goto("/");
    await second.goto("/");
    for (const tab of [page, second])
        await tab.evaluate(async () => {
            await import("./auth");
        });
    await page.evaluate(async () => {
        await (await import("./auth")).rememberUser("us_first");
    });
    await expect
        .poll(() => second.evaluate(async () => (await import("./auth")).events.changed))
        .toBe(1);

    const seen: (string | undefined)[] = [];
    await context.route("**/auth-test/**", async (route) => {
        seen.push(route.request().headers()["x-expected-user"]);
        const session = route.request().url().endsWith("/gone");
        await route.fulfill({
            status: session ? 401 : 200,
            json: session ? { error: "unauthenticated" } : { ok: true },
        });
    });
    expect(
        await second.evaluate(async () => {
            const response = await (await import("./auth")).api.authFetchFor("us_first")("/data");
            return response.status;
        }),
    ).toBe(200);
    expect(seen).toEqual(["us_first"]);

    await page.evaluate(async () => {
        await (await import("./auth")).rememberUser("us_second");
    });
    await expect
        .poll(() => second.evaluate(async () => (await import("./auth")).events.changed))
        .toBe(2);
    const actorError = await second.evaluate(async () => {
        try {
            await (await import("./auth")).api.authFetchFor("us_first")("/v1/hours/staff/week");
        } catch {
            return true;
        }
        return false;
    });
    expect(actorError).toBe(true);

    await second.evaluate(async () => {
        await (await import("./auth")).api.get("/gone").catch(() => undefined);
    });
    expect(await second.evaluate(async () => (await import("./auth")).events.signedOut)).toBe(1);
    await expect
        .poll(() => page.evaluate(async () => (await import("./auth")).getUserId()))
        .toBeNull();
});
