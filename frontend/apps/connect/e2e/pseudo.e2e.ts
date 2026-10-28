import { clippedText, englishCopy } from "@clientbridge/config/e2e/pseudo";
import { expect, test } from "@playwright/test";

import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

const PAGES = [
    { name: "business", path: on(links.slug, "/", "pseudo") },
    { name: "booking", path: `/${links.slug}` },
    { name: "shop", path: on("shop", `/${links.slug}`, "pseudo") },
    { name: "invoice", path: on("pay", `/i/${links.invoice}`, "pseudo") },
    { name: "estimate", path: on("pay", `/e/${links.estimate}`, "pseudo") },
    { name: "receipt", path: on("pay", `/r/${links.receipt}`, "pseudo") },
];

const strings = (value: unknown): string[] =>
    typeof value === "string"
        ? [value.replace(/\s+/g, " ").trim()]
        : Array.isArray(value)
          ? value.flatMap(strings)
          : typeof value === "object" && value !== null
            ? Object.values(value).flatMap(strings)
            : [];

for (const { name, path } of PAGES) {
    test(`the ${name} page reads every text from the en-XA catalog`, async ({ page }) => {
        // What the API returns (service, category and reply text) is the business's own data.
        const data = new Set<string>();
        page.on("response", (response) => {
            if (!response.headers()["content-type"]?.includes("application/json")) return;
            response
                .json()
                .then((body: unknown) => {
                    for (const text of strings(body)) data.add(text);
                })
                .catch(() => undefined);
        });
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
        await expect(page.locator("main")).not.toHaveText("");
        await page.waitForLoadState("networkidle");
        expect(await englishCopy(page, "body", data)).toEqual([]);
        expect(await clippedText(page)).toEqual([]);
    });
}
