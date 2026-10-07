import {
    createPublicEstimateClient,
    formatMoney,
    longDate,
    registrationLine,
    strings,
    usePublicEstimatePage,
} from "@clientbridge/app-core/public";
import { Button, Checkbox, DocTotals, Icon, Notice, TextField } from "@clientbridge/ui";
import { cssVar } from "@clientbridge/tokens";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { PrintModal, PublicDocument } from "../components/PublicDocument";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const client = createPublicEstimateClient(config.apiUrl);
const pe = strings.publicEstimate;

export function PublicEstimate() {
    const { token = "" } = useParams<{ token: string }>();
    const page = usePublicEstimatePage(client, token);
    const [printing, setPrinting] = useState(false);
    useEmbedSuccess(page.status === "accepted", "estimate");

    if (page.status === "loading") return <PublicStatus kind="loading" />;
    if (page.status === "not-found")
        return <PublicStatus kind="notFound" title={pe.notFoundTitle} body={pe.notFoundBody} />;
    const est = page.estimate;
    if (page.status === "error" || est === null) return <PublicStatus kind="error" />;

    const biz = est.business_name;
    const open = page.status === "open";
    const doc = page.printed(cssVar("accent"));

    return (
        <PublicDocument
            brand={est.brand}
            businessName={biz}
            contact={est.contact_email}
            footer={pe.poweredBy}
        >
            <main className="mx-auto max-w-3xl px-4 pb-36 pt-6 sm:px-5 sm:pt-10">
                {page.status === "accepted" || page.status === "declined" ? (
                    <section className="mb-6 flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-10 text-center shadow-card">
                        <span
                            className={`flex h-14 w-14 items-center justify-center rounded-full ${page.status === "accepted" ? "bg-ok-bg text-ok-fg" : "bg-bg text-muted"}`}
                        >
                            <Icon name={page.status === "accepted" ? "check" : "x"} size={26} />
                        </span>
                        <h1 className="mt-4 font-display text-xl font-bold text-ink">
                            {page.status === "accepted" ? pe.acceptedTitle : pe.declinedTitle}
                        </h1>
                        <p className="mt-1 max-w-sm text-sm text-ink-soft">
                            {page.status === "accepted"
                                ? pe.acceptedBody(biz)
                                : pe.declinedBody(biz)}
                        </p>
                    </section>
                ) : null}
                {page.status === "expired" ? (
                    <section className="mb-6 rounded-xl border border-line bg-surface px-6 py-6 text-center shadow-card">
                        <h1 className="font-display text-xl font-bold text-ink">
                            {pe.expiredTitle}
                        </h1>
                        <p className="mt-1 text-sm text-ink-soft">{pe.expiredBody(biz)}</p>
                    </section>
                ) : null}
                <article className="rounded-xl border border-line bg-surface shadow-card">
                    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-6 py-6">
                        <div>
                            <p className="text-sm text-muted">{pe.from(biz)}</p>
                            <h1 className="mt-0.5 font-display text-2xl font-bold text-ink">
                                {est.number !== null ? pe.estimateNumber(est.number) : pe.estimate}
                            </h1>
                            {est.client_name !== null ? (
                                <p className="mt-1 text-sm text-ink-soft">
                                    {pe.preparedFor(est.client_name)}
                                </p>
                            ) : null}
                        </div>
                        <div className="sm:text-right">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted">
                                {pe.estimateTotal}
                            </p>
                            <p className="font-display text-3xl font-bold tabular-nums text-ink">
                                {page.totalLabel}
                            </p>
                            {est.valid_until !== null ? (
                                <p
                                    className={`text-xs ${page.status === "expired" ? "font-medium text-danger" : "text-muted"}`}
                                >
                                    {pe.validUntil(longDate(est.valid_until))}
                                </p>
                            ) : null}
                        </div>
                    </header>
                    {est.notes !== null ? (
                        <p className="border-b border-line-soft px-6 py-4 text-sm leading-relaxed text-ink-soft">
                            {est.notes}
                        </p>
                    ) : null}
                    <div className="px-6 py-5">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {pe.lines}
                        </h2>
                        <ul className="mt-2 divide-y divide-line-soft">
                            {est.lines
                                .filter((l) => !l.optional || open || l.selected)
                                .map((l) => (
                                    <li
                                        key={l.id}
                                        className="flex items-start justify-between gap-4 py-3 text-sm"
                                    >
                                        <div className="flex min-w-0 gap-3">
                                            {l.optional && open ? (
                                                <Checkbox
                                                    label={l.description}
                                                    hideLabel
                                                    value={page.picked.has(l.id)}
                                                    onChange={() => {
                                                        page.toggle(l.id);
                                                    }}
                                                />
                                            ) : null}
                                            <div className="min-w-0">
                                                <p className="font-medium text-ink">
                                                    {l.description}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted">
                                                    {[
                                                        l.optional ? pe.optional : null,
                                                        strings.billing.qtyTimes(
                                                            l.quantity,
                                                            formatMoney(l.unit_amount_cents),
                                                        ),
                                                        l.tax_codes.join(" + "),
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" · ")}
                                                </p>
                                                {l.optional && open ? (
                                                    <p className="text-xs text-muted">
                                                        {pe.optionalNote}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <span
                                            className={`font-medium tabular-nums ${l.optional && !page.picked.has(l.id) && open ? "text-muted" : "text-ink"}`}
                                        >
                                            {formatMoney(l.amount_cents)}
                                        </span>
                                    </li>
                                ))}
                        </ul>
                        <div className="ml-auto mt-3 max-w-xs">
                            <DocTotals lines={page.totals} />
                        </div>
                    </div>
                    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 text-xs text-muted">
                        <span>{registrationLine(est.gst_hst_number, est.qst_number)}</span>
                        {doc !== null ? (
                            <Button
                                size="sm"
                                variant="outline"
                                icon="receipt"
                                onPress={() => {
                                    setPrinting(true);
                                }}
                            >
                                {pe.downloadPdf}
                            </Button>
                        ) : null}
                    </footer>
                </article>
            </main>

            {open ? (
                <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
                    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-5">
                        {page.declining ? (
                            <div className="space-y-3">
                                <TextField
                                    label={pe.declineReason}
                                    hint={pe.declineReasonHint}
                                    multiline
                                    rows={2}
                                    maxLength={500}
                                    value={page.reason}
                                    onChange={page.setReason}
                                    placeholder={pe.declinePlaceholder}
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="quiet"
                                        onPress={() => {
                                            page.setDeclining(false);
                                        }}
                                    >
                                        {pe.cancel}
                                    </Button>
                                    <Button
                                        variant="danger"
                                        busy={page.busy}
                                        onPress={page.decline}
                                    >
                                        {pe.sendDecline}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted sm:max-w-sm">
                                    {pe.acceptNote(biz)}
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onPress={() => {
                                            page.setDeclining(true);
                                        }}
                                    >
                                        {pe.decline}
                                    </Button>
                                    <Button
                                        grow
                                        size="lg"
                                        busy={page.busy}
                                        onPress={page.accept}
                                        icon="check"
                                    >
                                        {page.busy
                                            ? pe.accepting
                                            : page.picked.size > 0
                                              ? pe.acceptFor(page.totalLabel)
                                              : pe.accept}
                                    </Button>
                                </div>
                            </div>
                        )}
                        {page.error !== null ? <Notice tone="danger">{page.error}</Notice> : null}
                    </div>
                </div>
            ) : null}
            {printing && doc !== null ? (
                <PrintModal
                    doc={doc}
                    printLabel={pe.downloadPdf}
                    onClose={() => {
                        setPrinting(false);
                    }}
                />
            ) : null}
        </PublicDocument>
    );
}
