import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatClock, strings } from "@clientbridge/app-core/public";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { mailedCode, newAccount, ownerInvite } from "../identity";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

const execute = promisify(execFile);

interface HoursDay {
    weekday: number;
    available: boolean;
    start_time: string | null;
    end_time: string | null;
}

export interface HoursCommand {
    request: {
        version: number;
        business_id: string;
        device_id: string;
        operation_id: string;
        created_at: string;
    };
    expected_revision: number;
    days: HoursDay[];
}

export interface HoursEvidence {
    staff: { id: string; user_id: string; business_id: string; hours_revision: number };
    hours: HoursDay[];
    receipts: {
        device_id: string;
        operation_id: string;
        version: number;
        result: { revision: number };
    }[];
    audits: { action: string; performed_by: string; changes: { revision: number } }[];
}

export async function hoursEvidence(staffId: string): Promise<HoursEvidence> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_hours_evidence", staffId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as HoursEvidence;
}

/** Signs up through an invite link and joins; returns the new member's staff id. */
export async function acceptInvite(
    page: Page,
    request: APIRequestContext,
    token: string,
    account: { email: string; password: string; name: string },
): Promise<string> {
    await page.goto(`/accept-invite?token=${token}`);
    await expect(
        page.getByText(strings.staff.inviteFor(account.email), { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.staff.inviteSignUp, exact: true }).click();
    await page.getByLabel(strings.auth.name, { exact: true }).fill(account.name);
    await page.getByRole("textbox", { name: strings.auth.email, exact: true }).fill(account.email);
    await page.getByLabel(strings.auth.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: strings.auth.createAccount, exact: true }).click();
    await expect(page.getByRole("heading", { name: strings.auth.verifyTitle })).toBeVisible();
    await page
        .getByLabel(strings.auth.code, { exact: true })
        .fill(await mailedCode(request, account.email, "verification"));
    await page.getByRole("button", { name: strings.auth.verify, exact: true }).click();
    const joining = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/staff/invites/accept" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: strings.staff.inviteJoin, exact: true }).click();
    const joined = await joining;
    expect(joined.status(), await joined.text()).toBe(200);
    const body = (await joined.json()) as { staff_id: string };
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
    return body.staff_id;
}

export async function joinHoursStaff(
    page: Page,
    request: APIRequestContext,
): Promise<{
    id: string;
    name: string;
    account: ReturnType<typeof newAccount>;
    cleanup: () => Promise<void>;
}> {
    await requireLocalMail();
    const account = { ...newAccount("offline-hours"), name: demoPerson(randomUUID()) };
    const invitation = await ownerInvite(request, account.email);
    try {
        const id = await acceptInvite(page, request, invitation.token, account);
        return { id, name: account.name, account, cleanup: invitation.cleanup };
    } catch (error) {
        await invitation.cleanup();
        throw error;
    }
}

export async function openHours(page: Page, name: string): Promise<Locator> {
    await navigate(page, "/setup/team");
    await page
        .getByRole("row", { name: strings.hours.rowLabel(name), exact: true })
        .click({ timeout: 60_000 });
    const editor = page.getByRole("dialog", {
        name: strings.hours.editHoursFor(name),
        exact: true,
    });
    await expect(
        editor.getByRole("switch", { name: strings.hours.monday, exact: true }),
    ).toBeVisible();
    return editor;
}

export async function selectHoursTime(
    page: Page,
    editor: Locator,
    label: string,
    time: string,
): Promise<void> {
    await editor.getByRole("combobox", { name: label, exact: true }).click();
    await page
        .getByRole("listbox", { name: label, exact: true })
        .getByRole("option", { name: formatClock(time), exact: true })
        .click();
}

export async function expectMondayOnly(editor: Locator): Promise<void> {
    await expect(
        editor.getByRole("switch", { name: strings.hours.monday, exact: true }),
    ).toBeChecked();
    await expect(
        editor.getByRole("combobox", {
            name: strings.ui.startOf(strings.hours.monday),
            exact: true,
        }),
    ).toContainText(formatClock("10:00"));
    await expect(
        editor.getByRole("combobox", { name: strings.ui.endOf(strings.hours.monday), exact: true }),
    ).toContainText(formatClock("16:00"));
    for (const day of [
        strings.hours.tuesday,
        strings.hours.wednesday,
        strings.hours.thursday,
        strings.hours.friday,
        strings.hours.saturday,
        strings.hours.sunday,
    ]) {
        await expect(editor.getByRole("switch", { name: day, exact: true })).not.toBeChecked();
    }
}
