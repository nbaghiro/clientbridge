import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { type Locator, type Page, expect } from "@playwright/test";
import { demoId } from "@clientbridge/config/e2e/run";

import { select } from "./db";
import { navigate } from "./session";

const t = strings.staff.team;

export interface SentInvite {
    id: string;
    email: string;
    role: string;
    invite_token: string;
}

export async function openTeam(page: Page): Promise<void> {
    await navigate(page, "/setup/team");
    await expect(
        page.getByRole("button", { name: t.inviteMember, exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });
}

export function inviteDialog(page: Page): Locator {
    return page.getByRole("dialog").filter({ hasText: t.emails });
}

/** Sends one invite from the Team page's dialog and closes it, returning what the server made. */
export async function inviteFromDialog(
    page: Page,
    email: string,
    role: "admin" | "staff" | "contractor",
): Promise<SentInvite> {
    await page.getByRole("button", { name: t.inviteMember, exact: true }).first().click();
    const dialog = inviteDialog(page);
    await dialog.getByRole("textbox", { name: t.emails }).fill(email);
    await dialog.locator(`button[data-value="${role}"]`).click();
    const made = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/staff/invites" && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: t.send, exact: true }).click();
    const response = await made;
    expect(response.status(), await response.text()).toBe(201);
    const sent = page.getByRole("dialog").filter({ hasText: t.sentTitle(1) });
    await expect(sent.getByText(email)).toBeVisible();
    await sent.getByRole("button", { name: strings.common.done, exact: true }).click();
    return (await response.json()) as SentInvite;
}

export function inviteRow(page: Page, email: string): Locator {
    return page
        .getByRole("main")
        .locator("div")
        .filter({ hasText: email })
        .filter({ has: page.getByRole("button", { name: t.revoke, exact: true }) })
        .last();
}

export interface InviteRow {
    id: string;
    status: string;
    role: string;
    invited_at: string | null;
}

/** Every Birchbark staff row sent to `email`, whatever its case, oldest first. */
export function invitesTo(email: string): Promise<InviteRow[]> {
    return select<InviteRow>`
        SELECT id, status, role, invited_at::text FROM staff
        WHERE business_id = ${demoId("bz_birchbark")} AND lower(invite_email) = ${email.toLowerCase()}
        ORDER BY created_at, id`;
}

/** The Birchbark memberships of the account signed up with `email`. */
export function membershipsOf(email: string): Promise<{ id: string; status: string }[]> {
    return select<{ id: string; status: string }>`
        SELECT s.id, s.status FROM staff s JOIN users u ON u.id = s.user_id
        WHERE s.business_id = ${demoId("bz_birchbark")} AND u.email = ${email}`;
}

/** Dates invites this case sent `seconds` back, through the product's own models. */
export async function ageInvites(seconds: number, ids: string[]): Promise<void> {
    await promisify(execFile)(
        "uv",
        ["run", "python", "-m", "e2e.actions", "invite-age", "--", String(seconds), ...ids],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 60_000,
        },
    );
}

/** The seeded name of the demo client `id` in this run. */
export async function clientName(id: string): Promise<string> {
    const [row] = await select<{ name: string }>`SELECT name FROM clients WHERE id = ${demoId(id)}`;
    if (row === undefined) throw new Error(`demo client ${id} is missing`);
    return row.name;
}

/** The open business's client list finds `own` and nothing of `other`'s. */
export async function expectOnlyClientsOf(page: Page, own: string, other: string): Promise<void> {
    await navigate(page, "/clients");
    const search = page.getByRole("searchbox");
    await search.fill(own);
    await expect(page.getByRole("main").getByRole("button").filter({ hasText: own })).toHaveCount(
        1,
        {
            timeout: 60_000,
        },
    );
    await search.fill(other);
    await expect(page.getByRole("main").getByRole("button").filter({ hasText: own })).toHaveCount(
        0,
    );
    await expect(page.getByRole("main").getByRole("button").filter({ hasText: other })).toHaveCount(
        0,
    );
}
