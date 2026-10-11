import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import ts from "typescript";

import { clippedText, englishCopy } from "./pseudo";

const storiesDir = fileURLToPath(new URL("../src/stories", import.meta.url));
const PAGES = readdirSync(storiesDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();
const RENDERED = '[data-testid^="rendered-"]';

// Stories pass fixture text (names, labels, notes) as props; only the components' own copy must be en-XA.
function literals(file: string): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
            found.push(node.text.replace(/\s+/g, " ").trim());
        }
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
    return found;
}
const FIXTURES = new Set(
    [
        ...PAGES.map((name) => `${storiesDir}/${name}.tsx`),
        fileURLToPath(new URL("../src/kit.ts", import.meta.url)),
    ].flatMap(literals),
);

test("every story on web reads its component text from the en-XA catalog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const found: Record<string, string[]> = {};
    for (const name of PAGES) {
        await page.goto(`/#/${name}?platform=web`);
        await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
        await expect(page.locator("[data-example]").first()).toBeVisible();
        const problems = [
            ...(await englishCopy(page, '[data-twin="web"]', FIXTURES)),
            ...(await clippedText(page, '[data-twin="web"]')).map((t) => `clipped: ${t}`),
        ];
        if (problems.length > 0) found[name] = problems;
    }
    expect(found).toEqual({});
});

for (const device of ["iphone", "android"] as const) {
    test(`every story on ${device} reads its component text from the en-XA catalog`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: device === "iphone" ? 393 : 412, height: 900 });
        const found: Record<string, string[]> = {};
        for (const name of PAGES) {
            await page.goto(`/#/frame/${name}?device=${device}`);
            await page.reload();
            await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
            await expect(page.locator(RENDERED).first()).toBeAttached();
            const problems = [
                ...(await englishCopy(page, RENDERED, FIXTURES)),
                ...(await clippedText(page, RENDERED)).map((t) => `clipped: ${t}`),
            ];
            if (problems.length > 0) found[name] = problems;
        }
        expect(found).toEqual({});
    });
}
