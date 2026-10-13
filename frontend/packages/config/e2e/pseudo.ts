import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

// Shared by the web and Connect pseudo-locale passes (VITE_PSEUDO_LOCALE=1).
const ACCENTED = /[åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇĐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ]/;

const catalog = JSON.parse(
    readFileSync(new URL("../../app-core/locales/en-CA.json", import.meta.url), "utf8"),
) as Record<string, { message: string }>;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The message's text outside its {arguments}, as a pattern that matches it whatever the arguments. */
function pattern(message: string): RegExp | null {
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    for (const c of message) {
        if (c === "{") {
            if (depth === 0) {
                parts.push(current);
                current = "";
            }
            depth += 1;
        } else if (c === "}") {
            depth -= 1;
        } else if (depth === 0) {
            current += c;
        }
    }
    parts.push(current);
    // A short fixed part, such as "{amount} for {client}", would match ordinary data.
    const letters = (parts.join("").match(/\p{L}/gu) ?? []).length;
    if (letters < (parts.length === 1 ? 3 : 8)) return null;
    const body = parts.map((p) => escape(p).replace(/\s+/g, "\\s+")).join(".+");
    return new RegExp(`^${body.trim()}$`, "u");
}

// Placeholders hold sample data ("Hannah Wong", "Bella") that the seed also uses.
const ENGLISH = Object.entries(catalog)
    .filter(([key]) => !/placeholder|example/i.test(key))
    .map(([, e]) => pattern(e.message.replace(/\s+/g, " ").trim()))
    .filter((p): p is RegExp => p !== null);

// Month, weekday and day-period names come from Intl, which has no en-XA data and falls back to English.
const INTL_WORDS = new Set(["am", "pm", "a.m", "p.m", "a.m.", "p.m."]);
for (const style of ["long", "short", "narrow"] as const) {
    for (let i = 0; i < 12; i += 1) {
        const at = new Date(Date.UTC(2026, i, 15));
        INTL_WORDS.add(at.toLocaleString("en", { month: style, timeZone: "UTC" }).toLowerCase());
    }
    for (let i = 0; i < 7; i += 1) {
        const at = new Date(Date.UTC(2026, 9, 4 + i));
        INTL_WORDS.add(at.toLocaleString("en", { weekday: style, timeZone: "UTC" }).toLowerCase());
    }
}

const onlyIntl = (text: string): boolean =>
    text
        .toLowerCase()
        .split(/[^\p{L}.]+/u)
        .every(
            (w) => !/\p{L}/u.test(w) || INTL_WORDS.has(w) || INTL_WORDS.has(w.replace(/\.$/, "")),
        );

/** Visible text and copy attributes inside `scope`. */
async function visibleText(page: Page, scope: string): Promise<string[]> {
    return page.evaluate((selector) => {
        const found = new Set<string>();
        const add = (raw: string | null): void => {
            const text = (raw ?? "").replace(/\s+/g, " ").trim();
            if (text !== "") found.add(text);
        };
        for (const root of document.querySelectorAll(selector)) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const el = n.parentElement;
                if (el === null || el.closest("script, style, noscript, [aria-hidden='true']")) {
                    continue;
                }
                if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                    add(n.textContent);
                }
            }
            for (const el of root.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
                if (!el.checkVisibility()) continue;
                for (const name of ["aria-label", "title", "placeholder", "alt"]) {
                    add(el.getAttribute(name));
                }
            }
        }
        return [...found];
    }, scope);
}

/** Catalog copy still rendered in English while en-XA is active; `data` holds values a business typed. */
export async function englishCopy(
    page: Page,
    scope = "body",
    data: ReadonlySet<string> = new Set(),
): Promise<string[]> {
    return (await visibleText(page, scope)).filter(
        (text) =>
            !ACCENTED.test(text) &&
            !onlyIntl(text) &&
            !data.has(text) &&
            ![...data].some((d) => d.length >= 12 && text.includes(d)) &&
            ENGLISH.some((p) => p.test(text)),
    );
}

/** Text cut off by a box that hides its overflow without an ellipsis. */
export async function clippedText(page: Page, scope = "body"): Promise<string[]> {
    return page.evaluate((selector) => {
        const clipped: string[] = [];
        for (const root of document.querySelectorAll(selector)) {
            for (const el of root.querySelectorAll<HTMLElement>("*")) {
                const own = [...el.childNodes].some(
                    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
                );
                // Screen-reader-only text is clipped to one pixel on purpose.
                if (!own || !el.checkVisibility() || el.clientWidth <= 1) continue;
                const style = getComputedStyle(el);
                const hides = ["hidden", "clip"].includes(style.overflowX);
                if (
                    hides &&
                    style.textOverflow !== "ellipsis" &&
                    el.scrollWidth > el.clientWidth + 1
                ) {
                    clipped.push(el.textContent.trim().slice(0, 80));
                }
            }
        }
        return clipped;
    }, scope);
}
