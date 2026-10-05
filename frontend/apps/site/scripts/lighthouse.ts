// Fails below 95 in any desktop category on three pages; run `pnpm preview` first.
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

const base = (process.env.SITE_UNDER_TEST ?? "http://localhost:8710").replace(/\/+$/, "");
const PAGES = ["/", "/solutions", "/solutions/pet-grooming"];
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
const BUDGET = 95;

const chrome = await launch({ chromeFlags: ["--headless=new"] });
const failures: string[] = [];
try {
    for (const preset of ["desktop", "mobile"] as const) {
        for (const page of PAGES) {
            const result = await lighthouse(
                `${base}${page}`,
                {
                    port: chrome.port,
                    output: "json",
                    logLevel: "error",
                    onlyCategories: [...CATEGORIES],
                },
                preset === "desktop" ? desktopConfig : undefined,
            );
            const categories = result?.lhr.categories ?? {};
            const scores = CATEGORIES.map((c) => Math.round((categories[c]?.score ?? 0) * 100));
            process.stdout.write(
                `${preset.padEnd(8)} ${page.padEnd(26)} ${CATEGORIES.map((c, i) => `${c} ${String(scores[i])}`).join("  ")}\n`,
            );
            if (preset === "desktop") {
                CATEGORIES.forEach((c, i) => {
                    if ((scores[i] ?? 0) < BUDGET)
                        failures.push(`${page} ${c} ${String(scores[i])}`);
                });
            }
        }
    }
} finally {
    chrome.kill();
}

if (failures.length > 0) {
    process.stderr.write(`below the ${String(BUDGET)} budget: ${failures.join(", ")}\n`);
    process.exit(1);
}
