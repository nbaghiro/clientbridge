import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { demoId, runEmail, runUrl } from "@clientbridge/config/e2e/run";

function routes(): string[] {
    return [
        "/today",
        "/schedule",
        "/schedule/classes",
        "/schedule/series",
        "/clients",
        ...["history", "subjects"].map((tab) => `/clients/${demoId("cl_amelie")}/${tab}`),
        ...[
            "invoices",
            "sales",
            "gift-cards",
            "refunds",
            "staff-pay",
            "tax",
            "payouts",
            "reports",
        ].map((tab) => `/payments/${tab}`),
        "/inbox",
        ...["reviews", "broadcasts", "forms", "contracts"].map((tab) => `/inbox?segment=${tab}`),
        ...[
            "start",
            "business",
            "services",
            "team",
            "getting-paid",
            "taxes",
            "online-booking",
            "reminders",
        ].map((tab) => `/setup/${tab}`),
    ];
}

test("presentation demo: synced data loads throughout owner surfaces", async ({
    page,
    request,
}) => {
    test.skip(
        process.env.DEMO_E2E !== "1",
        "Run with DEMO_E2E=1 against the standard seeded local stack",
    );
    test.setTimeout(120_000);
    const api = runUrl("VITE_API_URL");
    const health = await request.get(`${api}/health`);
    const state = (await health.json()) as { status?: string };
    expect(state.status).toBe("ok");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
        if (response.url().startsWith(`${api}/`) && response.status() >= 400)
            errors.push(`${String(response.status())} ${response.url()}`);
    });
    await page.goto("/");
    await page.fill('input[type="email"]', runEmail("hannah@birchbark.example"));
    await page.fill('input[type="password"]', "demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/clients");
    await expect(
        page.locator("main").getByText("Amélie Tremblay", { exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });
    for (const route of routes()) {
        await test.step(route, async () => {
            await page.goto(route);
            await expect(page.locator("main")).toBeVisible();
            await expect(page.locator("main")).not.toHaveText("");
            await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
            await expect(
                page.locator("main").getByText(strings.common.loading, { exact: true }),
            ).toHaveCount(0);
            await expect(page.locator("main").getByRole("heading").first()).toBeVisible();
        });
    }
    expect(errors).toEqual([]);
});
