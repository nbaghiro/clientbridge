import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { demoId } from "@clientbridge/config/e2e/run";
import { expect, type Frame, type Page, type TestInfo } from "@playwright/test";
import { select } from "../../../../web/e2e/support/db";
import { artifact, periodDates, reports } from "../../../../web/e2e/support/reports";

const execute = promisify(execFile);
const s = strings.payouts;

/** Reads the leased merchant, or puts back what a case changed on it (`e2e.merchant`). */
export async function merchant<T>(command: string, id = ""): Promise<T> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.merchant", command, ...(id ? [id] : [])],
        {
            cwd: fileURLToPath(new URL("../../../../../../backend", import.meta.url)),
            timeout: 60_000,
        },
    );
    return JSON.parse(stdout) as T;
}

export interface StripePayout {
    id: string;
    amount: number;
    currency: string;
    status: string;
    automatic: boolean;
    method: string;
    arrival_date: number;
}

export interface PayoutSchedule {
    interval: string;
    delay_days?: number;
}

/** The Stripe-hosted frame (embedded component or its dialog layer) showing this button. */
export async function stripeFrame(page: Page, button: RegExp, overlay = false): Promise<Frame> {
    let found: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames()) {
                    if (!frame.url().startsWith("https://connect-js.stripe.com/")) continue;
                    // a component's dialogs open in its accessory layer, apart from the component
                    if (overlay && !frame.url().includes("accessory_layer")) continue;
                    if (
                        await frame
                            .getByRole("button", { name: button })
                            .first()
                            .isVisible()
                            .catch(() => false)
                    ) {
                        found = frame;
                        return true;
                    }
                }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!found) throw new Error(`Stripe frame with ${String(button)} did not appear`);
    return found;
}

export interface PayoutLeg {
    journal_id: string;
    ref: string;
    category: string;
    amount_cents: number;
}

export function payoutJournals(payoutId: string): Promise<PayoutLeg[]> {
    return select<PayoutLeg>`
        SELECT e.journal_id, e.ref, a.category, e.amount_cents
        FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.business_id = ${demoId("bz_birchbark")} AND e.source_type = 'stripe_payout'
            AND e.source_id = ${payoutId}
        ORDER BY e.ref, a.category`;
}

/** The Deposited figure on the payouts page, in cents. */
export async function depositedCents(page: Page): Promise<number> {
    const stat = page.getByText(s.depositedHint, { exact: true }).locator("xpath=..");
    const shown = (await stat.locator("p").nth(1).innerText()).replace(/[^0-9.-]/g, "");
    return Math.round(Number(shown) * 100);
}

/** The Bank deposits file of this month's bookkeeper pack, as CSV rows. */
export async function bankDeposits(page: Page, info: TestInfo, tag: string): Promise<string[][]> {
    await reports(page, "thisMonth");
    await page.getByRole("button", { name: strings.reports.bookkeeperPack, exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.uncheck();
    await dialog
        .getByRole("checkbox", { name: strings.reports.library.payouts, exact: true })
        .check();
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: strings.reports.packDownload, exact: true }).click();
    const download = await pending;
    const path = info.outputPath(`${tag}.zip`);
    await download.saveAs(path);
    await info.attach(tag, { path, contentType: "application/zip" });
    const span = periodDates("thisMonth");
    const pack = await artifact(path);
    return pack.rows[`payouts-${span.start}-to-${span.end}.csv`] ?? [];
}
