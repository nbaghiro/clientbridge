import { readFile } from "node:fs/promises";
import { PAY_CODE_QUIET_ZONE, payCodeMatrix, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { demoSlug } from "@clientbridge/config/e2e/run";
import { bookingCode, openSite } from "./support/onlineBooking";
import { navigate, signIn } from "./support/session";
import { connectUrl } from "./support/visit";

const s = strings.onlineBooking;

/** The dark modules an SVG path of unit squares draws, as "column row" keys. */
function drawn(svg: string): Set<string> {
    const d = /<path[^>]* d="([^"]*)"/.exec(svg)?.[1] ?? "";
    return new Set(
        [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1] ?? ""} ${m[2] ?? ""}`),
    );
}

test("EMBED-E2E-03 online booking settings copy the booking link and the embed code, the downloaded QR draws the link, and the copied code on another site loads the widget from the book host", async ({
    page,
    context,
}) => {
    const slug = demoSlug("birchbark");
    const link = connectUrl(slug);
    const book = new URL(link).origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);
    await navigate(page, "/setup/online-booking");
    const copy = page.getByRole("button", { name: s.copy, exact: true });
    await copy.first().click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await copy.last().click();
    const code = await page.evaluate(() => navigator.clipboard.readText());
    expect(code).toBe(bookingCode(slug));

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: s.qrDownload, exact: true }).click(),
    ]);
    const svg = await readFile(await download.path(), "utf8");
    const matrix = payCodeMatrix(link);
    const expected = new Set(
        matrix.flatMap((row, r) =>
            row.flatMap((on, c) => (on ? [`${String(c)} ${String(r)}`] : [])),
        ),
    );
    expect(drawn(svg)).toEqual(expected);
    // outside the app the file keeps its ink, a light background, the scanners' margin and a size
    const side = matrix.length + PAY_CODE_QUIET_ZONE * 2;
    const origin = -PAY_CODE_QUIET_ZONE;
    expect(svg).toContain(
        `viewBox="${String(origin)} ${String(origin)} ${String(side)} ${String(side)}"`,
    );
    expect(svg).toMatch(
        new RegExp(
            `<rect x="${String(origin)}" y="${String(origin)}" width="${String(side)}" height="${String(side)}" fill="rgb\\(255, 255, 255\\)"`,
        ),
    );
    expect(svg).toMatch(/<path[^>]* fill="rgb\(\d+, \d+, \d+\)"/);
    expect(svg).not.toContain("currentColor");
    expect(svg).toMatch(/<svg[^>]* width="1024" height="1024"/);
    expect(svg).not.toMatch(/<svg[^>]* class=/);

    await openSite(page, code);
    const frame = page.locator("connect-booking iframe");
    await expect(frame).toHaveAttribute("src", `${book}/${slug}?embed=1`);
    await expect(
        frame
            .contentFrame()
            .getByRole("heading", { name: strings.publicBooking.stepService, exact: true }),
    ).toBeVisible();
});
