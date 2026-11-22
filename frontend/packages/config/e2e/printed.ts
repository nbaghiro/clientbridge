import { expect, type Page } from "@playwright/test";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PrintedPage {
    text: string;
    // text drawn past the page's edges, which a printer would cut off
    outside: string[];
    images: number;
}

export interface Printed {
    title: string;
    pages: PrintedPage[];
}

// Chrome's print dialog keeps a margin of about 0.4in by default; page.pdf() keeps none.
const MARGIN = "0.4in";

async function readPdf(pdf: Buffer): Promise<PrintedPage[]> {
    const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
    const doc = await task.promise;
    const pages: PrintedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const [left = 0, bottom = 0, right = 0, top = 0] = page.view;
        const items = (await page.getTextContent()).items.flatMap((item) =>
            "str" in item && item.str.trim() !== "" ? [item] : [],
        );
        const ops = (await page.getOperatorList()).fnArray;
        pages.push({
            text: items
                .map((item) => item.str)
                .join(" ")
                .replace(/\s+/g, " "),
            outside: items
                .filter((item) => {
                    const [x = 0, y = 0] = item.transform.slice(4) as number[];
                    return (
                        x < left || x + item.width > right || y < bottom || y + item.height > top
                    );
                })
                .map((item) => item.str),
            images: ops.filter(
                (op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject,
            ).length,
        });
    }
    await task.destroy();
    return pages;
}

/** Saves what `press` sends to the print dialog as Save as PDF would, and reads it back. */
export async function printToPdf(page: Page, press: () => Promise<void>): Promise<Printed> {
    await page.evaluate(() => {
        Object.assign(window, { printedTitle: null });
        // keeps a copy of what print() is handed, as a desktop dialog does, then returns at once
        window.print = () => {
            const sheets = document.querySelectorAll<HTMLElement>(
                ".print-sheet:not([data-printed])",
            );
            for (const sheet of sheets) {
                const copy = sheet.cloneNode(true) as HTMLElement;
                copy.dataset.printed = "";
                document.body.append(copy);
            }
            Object.assign(window, { printedTitle: document.title, printedSheets: sheets.length });
            window.dispatchEvent(new Event("afterprint"));
        };
    });
    await press();
    const printed = await page.waitForFunction(
        () => (window as { printedTitle?: string | null }).printedTitle ?? null,
    );
    const title = (await printed.jsonValue()) ?? "";
    expect(
        await page.evaluate(() => (window as { printedSheets?: number }).printedSheets),
        "one sheet handed to print()",
    ).toBe(1);
    // a phone's print() returns before it renders the page, so the app keeps its sheet afterwards
    await page.evaluate(
        () =>
            new Promise<void>((done) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        done();
                    });
                });
            }),
    );
    expect(
        await page.locator(".print-sheet:not([data-printed])").count(),
        "the sheet kept after print() returns",
    ).toBe(1);
    const copyOnly = await page.addStyleTag({
        content: "@media print { .print-sheet:not([data-printed]) { display: none !important; } }",
    });
    const pdf = await page.pdf({
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    });
    await copyOnly.evaluate((style) => {
        style.parentNode?.removeChild(style);
    });
    await page.evaluate(() => {
        for (const copy of document.querySelectorAll("[data-printed]")) copy.remove();
    });
    return { title, pages: await readPdf(pdf) };
}

export interface PrintedExpectation {
    // what every printed document carries: the business's letterhead, the record's lines and totals
    content: readonly string[];
    // the closing lines, which must stay together on the last page
    footer: readonly string[];
    // the money summary, which must not break across pages
    together?: readonly string[];
    // what is printed once, such as each line, so a repeated page shows up
    once?: readonly string[];
}

/** The PDF carries the record and its letterhead logo, nothing is cut off and no page is blank. */
export function expectPrinted(printed: Printed, expected: PrintedExpectation): void {
    const { pages } = printed;
    const all = pages.map((p) => p.text).join(" ");
    // a line that wraps, such as a long link, reads back with a space where it broke
    const squashed = all.replace(/\s+/g, "");
    for (const text of expected.content) expect(squashed, text).toContain(text.replace(/\s+/g, ""));
    expect(pages[0]?.images ?? 0, "the logo on the first page").toBeGreaterThan(0);
    expect(pages.flatMap((p) => p.outside)).toEqual([]);
    const last = pages.at(-1)?.text ?? "";
    for (const text of expected.footer) expect(last, text).toContain(text);
    // a page that carries only the closing lines is the blank page the footer would push out
    const rest = expected.footer.reduce((text, line) => text.replace(line, ""), last);
    expect(rest.trim(), "the last page holds more than its footer").not.toBe("");
    for (const page of pages) expect(page.text.trim()).not.toBe("");
    const together = expected.together ?? [];
    expect(
        pages.some((page) => together.every((text) => page.text.includes(text))),
        `one page holds ${together.join(", ")}`,
    ).toBe(true);
    for (const text of expected.once ?? []) expect(all.split(text).length - 1, text).toBe(1);
}
