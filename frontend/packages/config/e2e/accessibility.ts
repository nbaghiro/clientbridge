import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** Serious and critical axe findings inside `scope`, as "rule: target". */
export async function axeIssues(page: Page, scope = "body"): Promise<string[]> {
    const { violations } = await new AxeBuilder({ page }).include(scope).analyze();
    return violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
}

interface Stop {
    end: boolean;
    name: string;
    indicated: boolean;
    visible: boolean;
    inScope: boolean;
}

// What the focused element looks like on and off focus, over itself and two ancestors (a wrapping field box).
async function focusStop(page: Page, scope: string): Promise<Stop> {
    return page.evaluate((selector) => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) {
            return { end: true, name: "", indicated: true, visible: true, inScope: false };
        }
        const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(
            (n): n is HTMLElement => n instanceof HTMLElement,
        );
        const look = (): string =>
            chain
                .map((n) => {
                    const s = getComputedStyle(n);
                    return [
                        s.outlineStyle,
                        s.outlineWidth,
                        s.outlineColor,
                        s.boxShadow,
                        s.borderColor,
                        s.backgroundColor,
                        s.textDecorationLine,
                    ].join("|");
                })
                .join("#");
        const focused = look();
        el.blur();
        const blurred = look();
        el.focus();
        const rect = el.getBoundingClientRect();
        return {
            end: false,
            name: (el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 40),
            indicated: focused !== blurred,
            visible: rect.width > 0 && rect.height > 0,
            inScope: el.closest(selector) !== null,
        };
    }, scope);
}

/** Tabs forward from the current focus and names each stop inside `scope` that shows no focus indicator. */
export async function unmarkedFocus(page: Page, scope = "main", stops = 40): Promise<string[]> {
    const missing: string[] = [];
    let reached = 0;
    for (let i = 0; i < stops; i += 1) {
        await page.keyboard.press("Tab");
        const stop = await focusStop(page, scope);
        if (stop.end) break;
        if (!stop.inScope) continue;
        reached += 1;
        if (!(stop.indicated && stop.visible)) missing.push(stop.name);
    }
    if (reached === 0) missing.push(`no focus stop inside ${scope}`);
    return missing;
}

// Text against what is behind it while the pointer is over it; a cover photo counts as its scrim over white or black.
async function hoverContrast(page: Page, scope: string, index: number): Promise<number> {
    return page
        .locator(`${scope} button:enabled:visible`)
        .nth(index)
        .evaluate(async (el) => {
            await Promise.all(el.getAnimations().map((a) => a.finished));
            const ctx = document.createElement("canvas").getContext("2d", {
                willReadFrequently: true,
            });
            if (!ctx) throw new Error("no canvas");
            const rgba = (css: string): [number, number, number, number] => {
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = css;
                ctx.fillRect(0, 0, 1, 1);
                const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
                return [r, g, b, a / 255];
            };
            const over = (
                top: [number, number, number, number],
                under: [number, number, number],
            ): [number, number, number] => [
                top[0] * top[3] + under[0] * (1 - top[3]),
                top[1] * top[3] + under[1] * (1 - top[3]),
                top[2] * top[3] + under[2] * (1 - top[3]),
            ];
            const luminance = ([r, g, b]: [number, number, number]): number => {
                const lin = (v: number): number => {
                    const s = v / 255;
                    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
            };
            const coverPhoto = (n: Element): boolean =>
                [...n.children].some(
                    (c) =>
                        c instanceof HTMLImageElement &&
                        getComputedStyle(c).position === "absolute",
                );
            const layers: [number, number, number, number][] = [];
            let bases: [number, number, number][] = [[255, 255, 255]];
            for (let n: Element | null = el; n; n = n.parentElement) {
                if (coverPhoto(n)) {
                    const scrim = rgba("rgba(0, 0, 0, 0.55)");
                    bases = [over(scrim, [255, 255, 255]), over(scrim, [0, 0, 0])];
                    break;
                }
                const fill = rgba(getComputedStyle(n).backgroundColor);
                if (fill[3] === 0) continue;
                if (fill[3] === 1) {
                    bases = [[fill[0], fill[1], fill[2]]];
                    break;
                }
                layers.push(fill);
            }
            const text = rgba(getComputedStyle(el).color);
            return Math.min(
                ...bases.map((base) => {
                    const back = layers.reduceRight<[number, number, number]>(
                        (under, top) => over(top, under),
                        base,
                    );
                    const [hi, lo] = [luminance(over(text, back)), luminance(back)].sort(
                        (a, b) => b - a,
                    );
                    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
                }),
            );
        });
}

/** Buttons in `scope` whose hovered text drops below AA: 4.5 for words, 3 for a glyph or symbol. */
export async function unreadableHover(page: Page, scope = "main"): Promise<string[]> {
    const buttons = page.locator(`${scope} button:enabled:visible`);
    // One button per look (its classes and its container's), so a long list is measured once.
    const looks = await buttons.evaluateAll((els) =>
        els.map((el) => ({
            look: `${el.getAttribute("class") ?? ""}#${el.parentElement?.getAttribute("class") ?? ""}`,
            glyphOnly: !/[\p{L}\p{N}]/u.test(el.textContent),
            name: (el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 40),
        })),
    );
    const seen = new Set<string>();
    const low: string[] = [];
    for (const [i, { look, glyphOnly, name }] of looks.entries()) {
        if (seen.has(look)) continue;
        seen.add(look);
        const button = buttons.nth(i);
        await button.scrollIntoViewIfNeeded();
        await button.hover();
        const ratio = await hoverContrast(page, scope, i);
        if (ratio < (glyphOnly ? 3 : 4.5)) low.push(`${name}: ${ratio.toFixed(2)}`);
    }
    return low;
}
