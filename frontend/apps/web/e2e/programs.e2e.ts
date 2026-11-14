import { randomUUID } from "node:crypto";
import { combineDayAndTime, dateKey, formatTime, strings } from "@clientbridge/app-core/public";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";
import { expect, test } from "@playwright/test";
import { navigate, signIn } from "./support/session";
import { apiCall, businessZone, teamMember } from "./support/visit";
const p = strings.programs;

test("CLS-E2E-04 scheduling a program starts with the signed-in instructor, and a refusal clears once the time changes", async ({
    page,
}) => {
    await signIn(page);
    const zone = await businessZone(page, demoSlug("birchbark"));
    const hannah = await teamMember(page, runEmail("hannah@birchbark.example"));
    const priya = await teamMember(page, runEmail("priya@birchbark.example"));
    const camp = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "class",
            name: `Puppy recall camp ${randomUUID().slice(0, 6)}`,
            duration_min: 60,
            capacity: 6,
            session_count: 3,
            online_bookable: true,
            staff_ids: [hannah.id, priya.id],
        },
        201,
    );
    await navigate(page, "/schedule/classes");
    await page.getByRole("tab", { name: p.tab, exact: true }).click();
    await page.getByRole("button", { name: p.newProgram }).first().click();
    const form = page.getByRole("dialog");
    await form.getByLabel(p.program, { exact: true }).click();
    await page.getByRole("option", { name: camp.name }).click();
    await expect(form.getByLabel(p.instructor, { exact: true })).toHaveText(hannah.name);

    const time = (hhmm: string): string =>
        formatTime(combineDayAndTime(dateKey(new Date(), zone), hhmm, zone), zone);
    const pick = async (hhmm: string): Promise<void> => {
        await form.getByLabel(p.time, { exact: true }).click();
        await page.getByRole("option", { name: time(hhmm), exact: true }).click();
    };
    const refusal = form.getByText(strings.api.scheduleConflict, { exact: true });
    // the form starts the camp next Monday, and Birchbark's groomers work Tuesday to Saturday
    await pick("10:00");
    const refused = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/programs" &&
            response.request().method() === "POST",
    );
    await form.getByRole("button", { name: p.create, exact: true }).click();
    expect((await refused).status()).toBe(409);
    await expect(refusal).toBeVisible();
    await pick("10:30");
    await expect(refusal).toBeHidden();
    await form.getByRole("button", { name: p.close, exact: true }).click();
    await expect(form).toBeHidden();
});
