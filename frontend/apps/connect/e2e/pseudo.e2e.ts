import { readFileSync } from "node:fs";

import { clippedText, englishCopy } from "@clientbridge/config/e2e/pseudo";
import { expect, test, type Page } from "@playwright/test";

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
    { name: "contract", path: `/contract/${links.contract}` },
];

const pseudo = JSON.parse(
    readFileSync(new URL("../../../packages/app-core/locales/en-XA.json", import.meta.url), "utf8"),
) as Record<string, { message: string } | undefined>;
const xa = (key: string): string => pseudo[key]?.message ?? key;

const strings = (value: unknown): string[] =>
    typeof value === "string"
        ? // a contract's text renders line by line, each clause heading on its own
          [value, ...value.split("\n")].map((text) => text.replace(/\s+/g, " ").trim())
        : Array.isArray(value)
          ? value.flatMap(strings)
          : typeof value === "object" && value !== null
            ? Object.values(value).flatMap(strings)
            : [];

// What the API returns (service, category, contract and reply text) is the business's own data.
function businessData(page: Page): Set<string> {
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
    return data;
}

for (const { name, path } of PAGES) {
    test(`the ${name} page reads every text from the en-XA catalog`, async ({ page }) => {
        const data = businessData(page);
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
        await expect(page.locator("main")).not.toHaveText("");
        await page.waitForLoadState("networkidle");
        expect(await englishCopy(page, "body", data)).toEqual([]);
        expect(await clippedText(page)).toEqual([]);
    });
}

test("the contract page's decline question reads from the en-XA catalog", async ({ page }) => {
    const data = businessData(page);
    await page.goto(`/contract/${links.contract}`);
    // asks only: the seeded request stays open for the other suites
    await page.getByRole("button", { name: xa("publicContract.decline"), exact: true }).click();
    await expect(page.getByRole("group", { name: xa("publicContract.declineAsk") })).toBeVisible();
    expect(await englishCopy(page, "body", data)).toEqual([]);
    expect(await clippedText(page)).toEqual([]);
});
