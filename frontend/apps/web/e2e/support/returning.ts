import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
import { mailedCode } from "../identity";
import { bookingApi, createBookingFixture, type BookingFixture } from "./bookings";
import { addPet, type ClientFixture } from "./crm";
import { pastExtras } from "./scheduling";

const execute = promisify(execFile);
export interface ReturningFixture extends BookingFixture {
    client: ClientFixture;
    petId: string;
}
interface ReturningEvidence {
    clients: { id: string; name: string; email: string; phone: string | null; status: string }[];
    subjects: { id: string; client_id: string; name: string; deleted_at: string | null }[];
    bookings: { id: string; client_id: string; subject_id: string; status: string }[];
    slots: { id: string; item_id: string; staff_id: string }[];
    challenges: { id: string; client_id: string; attempts: number; verified: boolean }[];
}
export async function returningEvidence(f: ReturningFixture): Promise<ReturningEvidence> {
    const { stdout } = await execute(
        "uv",
        [
            "run",
            "python",
            "-m",
            "scripts.e2e_returning_evidence",
            f.clientId,
            f.clientEmail,
            f.itemId,
        ],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as ReturningEvidence;
}
export async function returningFixture(page: Page): Promise<ReturningFixture> {
    const f = await createBookingFixture(page);
    const response = await page.request.patch(`${bookingApi()}/v1/items/${f.itemId}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { online_bookable: true },
    });
    expect(response.status(), await response.text()).toBe(200);
    const client = { id: f.clientId, name: f.clientName, email: f.clientEmail };
    await addPet(page, client, "Maple");
    const petId = await addPet(page, client, "Clover");
    return { ...f, client, petId };
}
export async function verifyReturning(
    page: Page,
    f: ReturningFixture,
    week: number,
): Promise<void> {
    const b = strings.publicBooking;
    const t = strings.publicReturning;
    const port = process.env.CONNECT_E2E_PORT;
    if (!port) throw new Error("Returning journeys require CONNECT_E2E_PORT");
    const availableDays = () =>
        page.waitForResponse(
            (r) => new URL(r.url()).pathname === "/book/birchbark/days" && r.status() === 200,
        );
    let loaded = availableDays();
    await page.goto(
        `http://book.localhost:${port}/birchbark?service=${f.itemId}&staff=${f.staffId}`,
    );
    await pastExtras(page);
    let response = await loaded;
    const days = page.getByRole("radiogroup", { name: b.date, exact: true });
    for (let index = 0; index < week; index++) {
        loaded = availableDays();
        await page.getByRole("button", { name: b.nextWeek, exact: true }).first().click();
        response = await loaded;
    }
    const availability = (await response.json()) as { days: { date: string; count: number }[] };
    const index = availability.days.findIndex((day, index) => index >= 2 && day.count > 0);
    expect(index, "A real available time exists in the isolated week").toBeGreaterThanOrEqual(2);
    const day = days.getByRole("radio").nth(index);
    await expect(day).toBeEnabled();
    await day.click();
    const time = page
        .getByRole("radiogroup", { name: b.openTimes, exact: true })
        .getByRole("radio")
        .first();
    await expect(time).toBeVisible();
    await time.click();
    await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    const intro = page.getByText(t.intro("pet"), { exact: true });
    if (!(await intro.isVisible()))
        await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    await intro.click();
    const panel = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: t.title, exact: true }) });
    await panel.getByRole("textbox", { name: t.email, exact: true }).fill(f.clientEmail);
    await panel.getByRole("button", { name: t.sendCode, exact: true }).click();
    await page
        .getByRole("textbox", { name: t.code, exact: true })
        .fill(await mailedCode(page.request, f.clientEmail, "booking verification"));
    const verified = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/book/birchbark/returning/verify",
    );
    await page.getByRole("button", { name: t.verify, exact: true }).click();
    const result = await verified;
    expect(result.status(), await result.text()).toBe(200);
    const body = (await result.json()) as { profile: Record<string, unknown> };
    expect(Object.keys(body.profile).sort()).toEqual([
        "email",
        "last_visit",
        "name",
        "phone",
        "subjects",
    ]);
    expect(body.profile.last_visit).toBeNull();
    await expect(
        page.getByRole("heading", { name: t.welcome(f.clientName), exact: true }),
    ).toBeVisible();
    await page
        .getByRole("group", { name: t.choose("pet"), exact: true })
        .getByRole("button", { name: "Clover", exact: true })
        .click();
    await expect(page.getByRole("textbox", { name: b.name, exact: true })).toHaveValue(
        f.clientName,
    );
}
