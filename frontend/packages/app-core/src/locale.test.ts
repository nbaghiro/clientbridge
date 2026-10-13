import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import english from "../locales/en-CA.json" with { type: "json" };
import * as core from "./index";
import { activeLocale, setPseudoLocale } from "./locale";
import { strings } from "./strings";

const compiled = vi.hoisted(() => ({ count: 0 }));

vi.mock("intl-messageformat", async (importOriginal) => {
    const real = await importOriginal<typeof import("intl-messageformat")>();
    class Counted extends real.IntlMessageFormat {
        constructor(...args: ConstructorParameters<typeof real.IntlMessageFormat>) {
            compiled.count += 1;
            super(...args);
        }
    }
    return { ...real, IntlMessageFormat: Counted };
});

const billing = strings.billing;

afterEach(async () => {
    await setPseudoLocale(false);
});

describe("catalog", () => {
    it("serves English from en-CA by default", () => {
        expect(activeLocale()).toBe("en-CA");
        expect(strings.common.cancel).toBe("Cancel");
        expect(billing.invoiceNo(1234)).toBe("Invoice #1234");
    });

    it("compiles each message once per locale", () => {
        const before = compiled.count;
        billing.overdueBy(3);
        const afterFirst = compiled.count;
        billing.overdueBy(4);
        billing.overdueBy(5);
        expect(afterFirst - before).toBeLessThanOrEqual(1);
        expect(compiled.count).toBe(afterFirst);
    });

    it("types and formats arguments from the ICU message", () => {
        expect(billing.overdueBy(1)).toBe("1 day overdue");
        expect(billing.overdueBy(21)).toBe("21 days overdue");
        expect(strings.recurrences.cancelSummary(2, "Jan 5", true)).toContain("refunded");
        expectTypeOf(billing.overdueBy).parameter(0).toEqualTypeOf<number>();
    });

    it("switches every leaf, including aliases taken at import, to the pseudo-locale", async () => {
        await setPseudoLocale(true);
        expect(activeLocale()).toBe("en-XA");
        expect(strings.common.cancel).toMatch(/^\[Çåñçéļ.*\]$/);
        expect(billing.overdueBy(1)).toMatch(/^\[1 ðåý öṽéŕðûé.*\]$/);
        expect(billing.statusLabel.paid).toMatch(/^\[Þåîð/);
        await setPseudoLocale(false);
        expect(strings.common.cancel).toBe("Cancel");
    });

    it("keeps label tables built at import time in step with the active locale", async () => {
        const messages = new Set(Object.values(english).map((e) => e.message));
        const labels: [() => unknown, string][] = [];
        const collect = (read: () => unknown, depth: number): void => {
            const value = read();
            if (typeof value === "string") {
                if (messages.has(value) && /[\p{Lu}\s]/u.test(value)) labels.push([read, value]);
            } else if (depth < 3 && typeof value === "object" && value !== null) {
                for (const key of Object.keys(value)) {
                    collect(() => (read() as Record<string, unknown>)[key], depth + 1);
                }
            }
        };
        for (const [name, value] of Object.entries(core)) {
            if (name !== "strings" && typeof value === "object") collect(() => value, 0);
        }
        expect(labels.length).toBeGreaterThan(50);
        await setPseudoLocale(true);
        const stale = labels.filter(([read]) => !String(read()).startsWith("["));
        expect(stale.map(([, english]) => english)).toEqual([]);
    });
});
