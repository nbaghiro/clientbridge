import { formatMonthDay } from "../datetime";
import { initials } from "../format";
import { strings } from "../strings";
import type {
    DocTotalLine,
    PrintedDoc,
    PrintedDocLabels,
    PrintedDocLine,
    PrintedDocTax,
} from "../ui";

export type PrintedKind = PrintedDoc["kind"];

/** What a business prints at the top of its documents. */
export interface Letterhead {
    avatarUrl?: string | null;
    name: string;
    tagline: string | null;
    brandColor: string | null;
    email: string | null;
    gstHstNumber: string | null;
    qstNumber: string | null;
}

const s = strings.printing;

const PRINT_LABELS: PrintedDocLabels = {
    from: s.from,
    item: s.item,
    qty: s.qty,
    price: s.price,
    tax: s.tax,
    amount: s.amount,
    taxSummary: s.taxSummary,
    taxBase: s.taxBase,
    howToPay: s.howToPay,
    scanToPay: s.scanToPay,
    paymentMethod: s.paymentMethod,
    page: s.page,
    forPet: s.forPet,
};

export function registrationLine(gstHst: string | null, qst: string | null): string {
    const parts = [gstHst ? s.gstNo(gstHst) : null, qst ? s.qstNo(qst) : null].filter(
        (p): p is string => p !== null,
    );
    return s.registration(parts);
}

/** A long date for a document ("October 14, 2026"), in the business's locale. */
export function longDate(iso: string | null): string {
    if (iso === null) return "";
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    return d.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
}

export function shortDate(iso: string | null): string {
    if (iso === null) return "";
    return formatMonthDay(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
}

interface PrintSource {
    kind: PrintedKind;
    number: string;
    partyName: string;
    partyLines: readonly string[];
    meta: readonly { label: string; value: string }[];
    lines: readonly PrintedDocLine[];
    taxes: readonly PrintedDocTax[];
    totals: readonly DocTotalLine[];
    headline: { label: string; cents: number };
    payment?: PrintedDoc["payment"];
    stamp?: string | null;
    payUrl?: string | null;
    instructions?: readonly string[];
    message?: string | null;
}

const PARTY_LABEL: Record<PrintedKind, string> = {
    invoice: s.billTo,
    estimate: s.preparedFor,
    receipt: s.receivedFrom,
};

/** One printed document, the same model the in-app preview and the Connect pages draw. */
export function printedDoc(
    src: PrintSource,
    letterhead: Letterhead,
    fallbackColor: string,
): PrintedDoc {
    return {
        kind: src.kind,
        title: s.kinds[src.kind],
        number: src.number,
        business: {
            name: letterhead.name,
            initials: initials(letterhead.name),
            avatarUrl: letterhead.avatarUrl ?? null,
            tagline: letterhead.tagline ?? "",
            brandColor: letterhead.brandColor ?? fallbackColor,
            address: [],
            phone: "",
            email: letterhead.email ?? "",
            website: "",
            registration: registrationLine(letterhead.gstHstNumber, letterhead.qstNumber),
        },
        partyLabel: PARTY_LABEL[src.kind],
        partyName: src.partyName,
        partyLines: src.partyLines,
        meta: src.meta,
        lines: src.lines,
        taxes: src.taxes,
        totals: src.totals,
        headline: src.headline,
        payment: src.payment ?? null,
        stamp: src.stamp ?? null,
        payUrl: src.payUrl ?? null,
        instructions: src.instructions ?? [],
        message: src.message ?? null,
        footer: s.thanks,
        labels: PRINT_LABELS,
    };
}

/** The rate a tax code is printed with ("5%", "9.975%"). */
export function ratePct(code: string, rateBps: number): string {
    if (code === "QST") return "9.975%";
    const pct = rateBps / 100;
    return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "")}%`;
}
