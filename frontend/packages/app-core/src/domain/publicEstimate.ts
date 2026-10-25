import { useState } from "react";

import { formatMoney } from "../format";
import { useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, PrintedDoc } from "../ui";
import { discountReason, docReference, longDate, printedDoc } from "./printing";
import { type PublicDocLine, type PublicDocTax, publicDocLines, publicDocTaxes } from "./publicPay";
import { type PublicBrand, usePublicResource } from "./publicResource";
import { failureMessage, refusal } from "../api";

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
    timezone: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    issued_at: string | null;
    valid_until: string | null;
    notes: string | null;
    decline_reason: string | null;
    discount_cents: number;
    discount_reason: string | null;
    lines: PublicEstimateLine[];
    taxes: PublicDocTax[];
}

interface PublicEstimateClient {
    getEstimate: (token: string) => Promise<PublicEstimate>;
    quote: (token: string, lineIds: readonly string[]) => Promise<PublicEstimate>;
    accept: (token: string, lineIds: string[], totalCents: number) => Promise<PublicEstimate>;
    decline: (token: string, reason: string | null) => Promise<PublicEstimate>;
}

export function createPublicEstimateClient(baseUrl: string): PublicEstimateClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            throw await refusal(res);
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
        quote: (token, lineIds) => {
            const query = new URLSearchParams(lineIds.map((id) => ["line_ids", id]));
            return request<PublicEstimate>(
                `/estimate/${encodeURIComponent(token)}?${query.toString()}`,
            );
        },
        accept: (token, lineIds, totalCents) =>
            post<PublicEstimate>(`/estimate/${encodeURIComponent(token)}/accept`, {
                line_ids: lineIds,
                total_cents: totalCents,
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

/** The client's estimate page: optional add-ons start unticked, and the server quotes each choice. */
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

    const choosing = data?.status === "sent";
    const choice = choosing ? [...picked].sort() : [];
    const quoted = useRemote<PublicEstimate | null>(
        () => (choice.length > 0 ? client.quote(token, choice) : Promise.resolve(null)),
        `${token}|${choice.join(",")}`,
    );
    const answers = (q: PublicEstimate): boolean =>
        q.lines.every((l) => !l.optional || l.selected === choice.includes(l.id));
    const quote =
        choice.length === 0
            ? data
            : quoted.data !== null && answers(quoted.data)
              ? quoted.data
              : null;
    const quoting = choice.length > 0 && quote === null;
    const shown = quote ?? data;
    const lines = shown?.lines.filter((l) => !l.optional || l.selected || picked.has(l.id)) ?? [];
    const taxes = publicDocTaxes(shown?.taxes ?? []).filter((t) => t.cents !== 0);
    const discount = shown?.discount_cents ?? 0;
    const totalCents = shown?.total_cents ?? 0;
    const totals: DocTotalLine[] = [
        ...(discount > 0
            ? [
                  {
                      key: "discount",
                      label: strings.publicReceipt.discount,
                      cents: discount,
                      kind: "credit" as const,
                      hint: discountReason(shown?.discount_reason) ?? undefined,
                  },
              ]
            : []),
        {
            key: "subtotal",
            label: pe.subtotal,
            cents: shown?.subtotal_cents ?? 0,
            kind: "subtotal",
        },
        ...taxes.map((t): DocTotalLine => ({
            key: t.code,
            label: t.label,
            cents: t.cents,
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
        totalLabel: data === null ? "" : formatMoney(totalCents, data.currency),
        declining,
        setDeclining,
        reason,
        setReason,
        busy: busy || (quoting && quoted.error === null),
        error: quoting && quoted.error !== null ? pe.quoteError : error,
        accept: () => {
            if (quote === null) {
                quoted.refresh().catch(() => undefined);
                return;
            }
            run(
                async () => {
                    setData(await client.accept(token, choice, quote.total_cents));
                },
                { errorMessage: (e) => failureMessage(e, pe.answerError) },
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
            const number = data.number === null ? null : String(data.number);
            return printedDoc(
                {
                    kind: "estimate",
                    currency: data.currency,
                    number,
                    partyName: data.client_name ?? "",
                    partyLines: [],
                    meta: [
                        { label: pr.estimateNumber, value: docReference(number) },
                        { label: pr.issued, value: longDate(data.issued_at, data.timezone) },
                        {
                            label: pr.validUntil,
                            value: longDate(data.valid_until, data.timezone),
                        },
                    ],
                    lines: publicDocLines(lines),
                    taxes,
                    totals,
                    headline: { label: pr.estimateTotal, cents: totalCents },
                    instructions:
                        data.valid_until !== null
                            ? [pr.acceptBy(longDate(data.valid_until, data.timezone))]
                            : [],
                    message: data.notes,
                },
                {
                    name: data.business_name,
                    avatarUrl: data.brand.logo_url,
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
