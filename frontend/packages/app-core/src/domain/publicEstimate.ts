import { useState } from "react";

import { formatMoney } from "../format";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, PrintedDoc } from "../ui";
import { longDate, printedDoc } from "./printing";
import { type PublicDocLine, type PublicDocTax, publicDocLines, publicDocTaxes } from "./publicPay";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicEstimateLine extends PublicDocLine {
    id: string;
    optional: boolean;
    selected: boolean;
    tax_cents: number;
    tax_by_code: Record<string, number>;
}

export interface PublicEstimate {
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    contact_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
    client_name: string | null;
    status: string;
    currency: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    issued_at: string | null;
    valid_until: string | null;
    notes: string | null;
    decline_reason: string | null;
    lines: PublicEstimateLine[];
    taxes: PublicDocTax[];
}

class PublicEstimateError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicEstimateError";
    }
}

interface PublicEstimateClient {
    getEstimate: (token: string) => Promise<PublicEstimate>;
    accept: (token: string, lineIds: string[]) => Promise<PublicEstimate>;
    decline: (token: string, reason: string | null) => Promise<PublicEstimate>;
}

export function createPublicEstimateClient(baseUrl: string): PublicEstimateClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicEstimateError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };
    const post = <T>(path: string, body: unknown): Promise<T> =>
        request<T>(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    return {
        getEstimate: (token) => request<PublicEstimate>(`/estimate/${encodeURIComponent(token)}`),
        accept: (token, lineIds) =>
            post<PublicEstimate>(`/estimate/${encodeURIComponent(token)}/accept`, {
                line_ids: lineIds,
            }),
        decline: (token, reason) =>
            post<PublicEstimate>(`/estimate/${encodeURIComponent(token)}/decline`, { reason }),
    };
}

type EstimatePageStatus =
    "loading" | "not-found" | "error" | "open" | "accepted" | "declined" | "expired";

interface PublicEstimatePage {
    status: EstimatePageStatus;
    estimate: PublicEstimate | null;
    picked: ReadonlySet<string>;
    toggle: (lineId: string) => void;
    totals: DocTotalLine[];
    totalCents: number;
    totalLabel: string;
    declining: boolean;
    setDeclining: (v: boolean) => void;
    reason: string;
    setReason: (v: string) => void;
    busy: boolean;
    error: string | null;
    accept: () => void;
    decline: () => void;
    printed: (fallbackColor: string) => PrintedDoc | null;
}

/** The client's estimate page: optional add-ons start unticked, and the total follows the ticks. */
export function usePublicEstimatePage(
    client: PublicEstimateClient,
    token: string,
): PublicEstimatePage {
    const { status: load, data, setData } = usePublicResource(client.getEstimate, token);
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState("");
    const { busy, error, run } = useAsyncAction();
    const pe = strings.publicEstimate;

    const included = (l: PublicEstimateLine): boolean =>
        !l.optional || (data?.status === "sent" ? picked.has(l.id) : l.selected);
    const lines = data?.lines.filter(included) ?? [];
    const subtotal = lines.reduce((a, l) => a + l.amount_cents, 0);
    const byCode = new Map<string, number>();
    for (const l of lines)
        for (const [code, cents] of Object.entries(l.tax_by_code))
            byCode.set(code, (byCode.get(code) ?? 0) + cents);
    const taxes = publicDocTaxes(
        (data?.taxes ?? []).map((t) => ({
            ...t,
            cents: byCode.get(t.code) ?? 0,
        })),
    ).filter((t) => t.cents !== 0);
    const missing = [...byCode.keys()].filter((c) => !taxes.some((t) => t.code === c));
    const tax = [...byCode.values()].reduce((a, b) => a + b, 0);
    const totalCents = subtotal + tax;
    const totals: DocTotalLine[] = [
        { key: "subtotal", label: pe.subtotal, cents: subtotal, kind: "subtotal" },
        ...taxes.map((t): DocTotalLine => ({
            key: t.code,
            label: t.label,
            cents: t.cents,
            kind: "tax",
        })),
        ...missing.map((c): DocTotalLine => ({
            key: c,
            label: c,
            cents: byCode.get(c) ?? 0,
            kind: "tax",
        })),
        { key: "total", label: pe.total, cents: totalCents, kind: "total" },
    ];

    const status: EstimatePageStatus =
        load !== "ready"
            ? load
            : data?.status === "accepted" || data?.status === "converted"
              ? "accepted"
              : data?.status === "declined"
                ? "declined"
                : data?.status === "expired"
                  ? "expired"
                  : data?.status === "sent"
                    ? "open"
                    : "not-found";

    return {
        status,
        estimate: data,
        picked,
        toggle: (id) => {
            setPicked((cur) => {
                const next = new Set(cur);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
        },
        totals,
        totalCents,
        totalLabel: formatMoney(totalCents),
        declining,
        setDeclining,
        reason,
        setReason,
        busy,
        error,
        accept: () => {
            run(
                async () => {
                    setData(await client.accept(token, [...picked]));
                },
                { errorMessage: pe.answerError },
            );
        },
        decline: () => {
            run(
                async () => {
                    setData(
                        await client.decline(token, reason.trim() === "" ? null : reason.trim()),
                    );
                    setDeclining(false);
                },
                { errorMessage: pe.answerError },
            );
        },
        printed: (fallbackColor) => {
            if (data === null) return null;
            const pr = strings.printing;
            const number = data.number === null ? pr.draftNumber : String(data.number);
            return printedDoc(
                {
                    kind: "estimate",
                    number,
                    partyName: data.client_name ?? "",
                    partyLines: [],
                    meta: [
                        { label: pr.estimateNumber, value: `#${number}` },
                        { label: pr.issued, value: longDate(data.issued_at) },
                        { label: pr.validUntil, value: longDate(data.valid_until) },
                    ],
                    lines: publicDocLines(lines),
                    taxes,
                    totals,
                    headline: { label: pr.estimateTotal, cents: totalCents },
                    instructions:
                        data.valid_until !== null ? [pr.acceptBy(longDate(data.valid_until))] : [],
                    message: data.notes,
                },
                {
                    name: data.business_name,
                    avatarUrl: data.brand.avatar_url ?? data.brand.logo_url,
                    tagline: data.brand.tagline,
                    brandColor: data.brand.primary,
                    email: data.contact_email,
                    gstHstNumber: data.gst_hst_number,
                    qstNumber: data.qst_number,
                },
                fallbackColor,
            );
        },
    };
}
