import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Locator, type Page } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";

/** The code Setup > Online booking hands a business to paste into its site. */
export function bookingCode(slug: string): string {
    const book = `http://book.localhost:${String(runPort("CONNECT_E2E_PORT"))}`;
    return `<connect-booking slug="${slug}"></connect-booking>\n<script src="${book}/embed.js" async></script>`;
}

/** Opens the business's own site with `code` pasted below a screen of its content. */
export async function openSite(page: Page, code: string): Promise<string> {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Riverside Dog Walkers</title>
<script>
window.successes = [];
document.addEventListener("connect:success", (event) => window.successes.push(event.detail.widget));
</script>
</head>
<body style="margin:0;padding:16px;font:16px system-ui">
<h1>Riverside Dog Walkers</h1>
<p style="height:1400px">Walks, drop-ins and grooming in Victoria.</p>
${code}
<p>Riverside Dog Walkers, 12 Wharf Street</p>
</body>
</html>`;
    // a real server, since Chrome refuses localhost scripts to a page it cannot place on a network
    const server = createServer((_, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    page.once("close", () => {
        server.closeAllConnections();
        server.close();
    });
    const site = `http://riverside-dog-walkers.localhost:${String((server.address() as AddressInfo).port)}`;
    await page.goto(`${site}/`);
    return site;
}

/** Every `connect:success` the site has heard, by widget. */
export function successes(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as { successes?: string[] }).successes ?? []);
}

/** Clicks `target` once the site is scrolled to it; Chrome won't scroll to a bar fixed in a frame. */
export async function clickInView(target: Locator): Promise<void> {
    await target.waitFor();
    const page = target.page();
    const box = await target.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    if (box !== null && (box.y < 0 || box.y + box.height > height)) {
        await page.evaluate(
            (by) => {
                window.scrollBy(0, by);
            },
            box.y + box.height / 2 - height / 2,
        );
    }
    await target.click();
}

/** How far the site would scroll sideways; zero when nothing is wider than the window. */
export function sideways(page: Page): Promise<number> {
    return page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
}

/** The frame's height against its page's content, which the widget reports as it changes. */
export async function expectSizedToContent(frame: Locator): Promise<void> {
    const gap = async (): Promise<number> => {
        const content = await frame
            .contentFrame()
            .locator("body")
            .evaluate((body) => Math.ceil(body.getBoundingClientRect().height));
        return Math.abs(((await frame.boundingBox())?.height ?? 0) - content);
    };
    await expect.poll(gap).toBeLessThan(2);
}

/** Whether `target` sits wholly inside the site's window, as a client would see it unscrolled. */
export async function inWindow(page: Page, target: Locator): Promise<boolean> {
    const box = await target.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    return box !== null && box.y >= 0 && box.y + box.height <= height;
}
