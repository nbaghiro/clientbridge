import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PATHS = [
    ...readFileSync(join(dist, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g),
].map(([, loc = ""]) => new URL(loc).pathname);

async function scrollThrough(page: Page): Promise<void> {
    await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 40));
        }
        window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");
}

test("the sitemap lists every page", () => {
    expect(PATHS.length).toBeGreaterThanOrEqual(15);
});

for (const path of PATHS) {
    test.describe(path, () => {
        test("is complete without JavaScript", async ({ request }) => {
            const res = await request.get(path);
            expect(res.status()).toBe(200);
            const html = await res.text();
            expect(html).toMatch(/<h1[\s>]/);
            expect(html).not.toContain('<script type="module"');
        });

        for (const width of [1440, 390]) {
            test(`renders cleanly at ${String(width)}px`, async ({ page }) => {
                const errors: string[] = [];
                page.on("console", (m) => {
                    if (m.type() === "error") errors.push(m.text());
                });
                page.on("pageerror", (e) => errors.push(e.message));
                await page.setViewportSize({ width, height: 900 });
                const res = await page.goto(path);
                expect(res?.status()).toBe(200);
                await scrollThrough(page);
                const broken = await page.$$eval("img", (imgs) =>
                    imgs
                        .filter((i) => !i.complete || i.naturalWidth === 0)
                        .map((i) => i.currentSrc || i.src),
                );
                expect(broken).toEqual([]);
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth - window.innerWidth,
                );
                expect(overflow).toBeLessThanOrEqual(0);
                expect(errors).toEqual([]);
            });
        }

        test("has no serious accessibility problems", async ({ page }) => {
            await page.goto(path);
            const { violations } = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                .analyze();
            const serious = violations
                .filter((v) => v.impact === "serious" || v.impact === "critical")
                .map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`);
            expect(serious).toEqual([]);
        });
    });
}

test("every internal link and asset resolves", async ({ page, request }) => {
    const targets = new Set<string>();
    for (const path of PATHS) {
        await page.goto(path);
        const found = await page.$$eval("a[href^='/'], img[src^='/'], source[srcset^='/']", (els) =>
            els.flatMap((el) => {
                const value =
                    el.getAttribute("href") ??
                    el.getAttribute("src") ??
                    el.getAttribute("srcset") ??
                    "";
                return value.split(",").map((part) => part.trim().split(" ")[0] ?? "");
            }),
        );
        for (const href of found) targets.add(href.split("#")[0] ?? "/");
    }
    const failed: string[] = [];
    for (const href of targets) {
        const res = await request.get(href);
        if (res.status() !== 200) failed.push(`${href} → ${String(res.status())}`);
    }
    expect(targets.size).toBeGreaterThan(50);
    expect(failed).toEqual([]);
});

test("unknown pages get the 404 page", async ({ request }) => {
    const res = await request.get("/no-such-page");
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("Page not found");
});
