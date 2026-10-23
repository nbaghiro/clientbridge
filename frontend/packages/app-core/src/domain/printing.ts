import { formatLongDate, formatMonthDay, readDate } from "../datetime";
import { formatRate, initials } from "../format";
import english from "../../locales/en-CA.json" with { type: "json" };
import { strings } from "../strings";
import { TAX_RATES } from "../taxRates";
import type {
    DocTotalLine,
    PrintedDoc,
    PrintedDocLabels,
    PrintedDocLine,
    PrintedDocTax,
} from "../ui";

type PrintedKind = PrintedDoc["kind"];

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
    get from() {
        return s.from;
    },
    get item() {
        return s.item;
    },
    get qty() {
        return s.qty;
    },
    get price() {
        return s.price;
    },
    get tax() {
        return s.tax;
    },
    get amount() {
        return s.amount;
    },
    get taxSummary() {
        return s.taxSummary;
    },
    taxBase: s.taxBase,
    get howToPay() {
        return s.howToPay;
    },
    get scanToPay() {
        return s.scanToPay;
    },
    get paymentMethod() {
        return s.paymentMethod;
    },
    get page() {
        return s.page(1, 1);
    },
    forSubject: s.forSubject,
    qtyTimes: strings.billing.qtyTimes,
};

export function registrationLine(gstHst: string | null, qst: string | null): string {
    const gst = gstHst ? s.gstNo(gstHst) : "";
    const quebec = qst ? s.qstNo(qst) : "";
    return gst !== "" && quebec !== "" ? s.registration(gst, quebec) : gst || quebec;
}

/** A document number as printed: "#1002", or "Draft" before it has one. */
export function docReference(number: string | null): string {
    return number === null ? s.draftNumber : s.reference(number);
}

const source: Readonly<Record<string, { message: string }>> = english;
const REASON_KEYS = Object.keys(source).filter((k) => k.startsWith("pos.desk.reasons."));

/** A stored discount reason; one of the preset reasons, stored as English text, shows in the active locale. */
export function discountReason(stored: string | null | undefined): string | null {
    if (stored === null || stored === undefined || stored === "") return null;
    const preset = REASON_KEYS.findIndex((k) => source[k]?.message === stored);
    return preset === -1 ? stored : (strings.pos.desk.reasons[preset] ?? stored);
}

/** A sale's number as printed: "S-1044", or empty before it has one. */
export function saleNumber(n: number | null): string {
    return n === null ? "" : s.saleNumber(n);
}

/** A long date for a document ("October 14, 2026"). */
export function longDate(iso: string | null, zone: string): string {
    return iso === null ? "" : formatLongDate(readDate(iso, zone), zone);
}

export function shortDate(iso: string | null, zone: string): string {
    return iso === null ? "" : formatMonthDay(readDate(iso, zone), zone);
}

interface PrintSource {
    kind: PrintedKind;
    currency: string;
    number: string | null;
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
    get invoice() {
        return s.billTo;
    },
    get estimate() {
        return s.preparedFor;
    },
    get receipt() {
        return s.receivedFrom;
    },
};

/** One printed document, the same model the in-app preview and the Connect pages draw. */
export function printedDoc(
    src: PrintSource,
    letterhead: Letterhead,
    fallbackColor: string,
): PrintedDoc {
    const title = s.kinds[src.kind];
    const reference = docReference(src.number);
    const last = src.meta[2];
    return {
        kind: src.kind,
        currency: src.currency,
        title,
        number: src.number ?? s.draftNumber,
        reference,
        heading: s.heading(title, reference),
        deadline: last === undefined ? "" : s.deadline(last.label, last.value),
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

/** A tax's name from its jurisdiction code ("GST", "QST"). */
export function taxName(code: string): string {
    return strings.taxes.names[code] ?? code;
}

/** Taxes charged together: "GST + PST", or "GST 5% + PST 7%" from rate labels. */
export function taxList(labels: readonly string[]): string {
    const [first = "", ...rest] = labels;
    return rest.reduce((all, next) => strings.taxes.plus(all, next), first);
}

/** A tax and the rate it is printed with: "GST 5%", "QST 9.975%". */
export function taxRateLabel(code: string, rateBps: number): string {
    return strings.taxes.rate(taxName(code), ratePct(code, rateBps));
}

/** The rate a tax code is printed with ("5%", "9.975%"); the API rounds rates to whole basis points. */
export function ratePct(code: string, rateBps: number): string {
    const exact = TAX_RATES.find((r) => r.code === code && Math.round(r.ppm / 100) === rateBps);
    return formatRate(exact === undefined ? rateBps : exact.ppm / 100);
}
