import { expect, test } from "@playwright/test";

function tokens(subject: string, sid = subject, rotated = false) {
    return {
        access_token: `header.${Buffer.from(JSON.stringify({ sub: subject, sid })).toString("base64url")}.${rotated ? "new" : "old"}`,
        refresh_token: rotated ? "rotated" : "initial",
    };
}

test("two browser tabs serialize refresh and observe account replacement and logout", async ({
    page,
    context,
}) => {
    const second = await context.newPage();
    await page.goto("/");
    await second.goto("/");
    await page.evaluate(async () => {
        await import("./auth");
    });
    await second.evaluate(async () => {
        await import("./auth");
    });
    const initial = tokens("first");
    const rotated = tokens("first", "first", true);
    await page.evaluate(async (pair) => {
        const auth = await import("./auth");
        await auth.setTokens(pair);
    }, initial);
    await expect
        .poll(() => second.evaluate(async () => (await import("./auth")).events.changed))
        .toBe(1);
    let refreshes = 0;
    await context.route("**/auth-test/**", async (route) => {
        if (route.request().url().endsWith("/auth/refresh")) {
            refreshes++;
            await route.fulfill({ status: 200, json: rotated });
        } else {
            const current =
                route.request().headers().authorization === `Bearer ${rotated.access_token}`;
            await route.fulfill({ status: current ? 200 : 401, json: { ok: current } });
        }
    });
    const results = await Promise.all(
        [page, second].map((tab) =>
            tab.evaluate(async () => {
                const auth = await import("./auth");
                return auth.api.get<{ ok: boolean }>("/data");
            }),
        ),
    );
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(await second.evaluate(async () => (await import("./auth")).events.changed)).toBe(1);
    await page.evaluate(async (pair) => {
        await (await import("./auth")).setTokens(pair);
    }, tokens("second"));
    await expect
        .poll(() => second.evaluate(async () => (await import("./auth")).events.changed))
        .toBe(2);
    const actorError = await second.evaluate(async () => {
        try {
            await (await import("./auth")).api.authFetchFor("first")("/v1/hours/staff/week");
        } catch {
            return true;
        }
        return false;
    });
    expect(actorError).toBe(true);
    await page.evaluate(async () => {
        await (await import("./auth")).clearTokens();
    });
    await expect
        .poll(() => second.evaluate(async () => (await import("./auth")).events.changed))
        .toBe(3);
    expect(await second.evaluate(async () => (await import("./auth")).getTokens())).toBeNull();
});
