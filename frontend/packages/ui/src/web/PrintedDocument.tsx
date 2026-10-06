import {
    type PrintedDocumentProps,
    formatMoney,
    type PrintedDoc,
    type PrintedDocLabels,
    type PrintedDocLine,
    type PrintedDocTax,
} from "@clientbridge/app-core/public";

import { DocTotals } from "./DocTotals";
import { PayCode } from "./PayCode";
import { type WebProps, cx } from "./props";

type Doc = PrintedDoc;

function BrandBlock({ doc, inverse = false }: { doc: Doc; inverse?: boolean }) {
    const b = doc.business;
    return (
        <div className="flex items-center gap-3">
            <span
                aria-hidden
                style={inverse ? { color: b.brandColor } : { backgroundColor: b.brandColor }}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md font-display text-sm font-bold ${inverse ? "bg-surface" : "text-on-data"}`}
            >
                {b.initials}
            </span>
            <div>
                <p
                    className={`font-display text-[15px] font-bold leading-tight ${inverse ? "text-on-data" : "text-ink"}`}
                >
                    {b.name}
                </p>
                <p className={`text-[11px] ${inverse ? "text-on-data/75" : "text-muted"}`}>
                    {b.tagline}
                </p>
            </div>
        </div>
    );
}

function Parties({ doc }: { doc: Doc }) {
    const b = doc.business;
    return (
        <div className="grid grid-cols-2 gap-6 text-[11px] leading-relaxed">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {doc.labels.from}
                </p>
                <p className="mt-1 font-semibold text-ink">{b.name}</p>
                {b.address.map((l) => (
                    <p key={l} className="text-ink-soft">
                        {l}
                    </p>
                ))}
                <p className="text-ink-soft">
                    {b.phone} · {b.email}
                </p>
            </div>
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {doc.partyLabel}
                </p>
                <p className="mt-1 font-semibold text-ink">{doc.partyName}</p>
                {doc.partyLines.map((l) => (
                    <p key={l} className="text-ink-soft">
                        {l}
                    </p>
                ))}
            </div>
        </div>
    );
}

function Meta({ doc, columns }: { doc: Doc; columns: boolean }) {
    return (
        <dl className={columns ? "grid grid-cols-3 gap-4 text-[11px]" : "space-y-1 text-[11px]"}>
            {doc.meta.map((m) => (
                <div key={m.label} className={columns ? "" : "flex justify-between gap-6"}>
                    <dt
                        className={
                            columns
                                ? "text-[10px] font-semibold uppercase tracking-wider text-muted"
                                : "text-muted"
                        }
                    >
                        {m.label}
                    </dt>
                    <dd className={`font-medium text-ink ${columns ? "mt-1" : ""}`}>{m.value}</dd>
                </div>
            ))}
        </dl>
    );
}

function LinesTable({ doc }: { doc: Doc }) {
    const l: PrintedDocLabels = doc.labels;
    return (
        <table className="w-full text-[11px]">
            <thead>
                <tr className="border-b border-ink/70 text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="pb-2 font-semibold">{l.item}</th>
                    <th className="pb-2 text-right font-semibold">{l.qty}</th>
                    <th className="pb-2 pl-3 text-right font-semibold">{l.price}</th>
                    <th className="pb-2 pl-3 text-left font-semibold">{l.tax}</th>
                    <th className="pb-2 pl-3 text-right font-semibold">{l.amount}</th>
                </tr>
            </thead>
            <tbody>
                {doc.lines.map((line: PrintedDocLine) => (
                    <tr key={line.id} className="border-b border-line-soft align-top">
                        <td className="py-2 pr-3">
                            <p className="font-medium text-ink">{line.description}</p>
                            {line.subject !== null ? (
                                <p className="text-muted">{l.forPet(line.subject)}</p>
                            ) : null}
                        </td>
                        <td className="py-2 text-right tabular-nums text-ink-soft">
                            {line.quantity}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums text-ink-soft">
                            {formatMoney(line.unitCents)}
                        </td>
                        <td className="py-2 pl-3 text-ink-soft">{line.taxCodes.join(" + ")}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right font-medium tabular-nums text-ink">
                            {formatMoney(line.amountCents)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function TaxSummary({ doc }: { doc: Doc }) {
    if (doc.taxes.length === 0) return null;
    return (
        <div className="text-[10px] text-muted">
            <p className="font-semibold uppercase tracking-wider">{doc.labels.taxSummary}</p>
            <table className="mt-1">
                <tbody>
                    {doc.taxes.map((t: PrintedDocTax) => (
                        <tr key={t.code}>
                            <td className="pr-4 text-ink-soft">{t.label}</td>
                            <td className="pr-4">
                                {doc.labels.taxBase} {formatMoney(t.baseCents)}
                            </td>
                            <td className="text-right tabular-nums text-ink-soft">
                                {formatMoney(t.cents)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PaymentBox({ doc }: { doc: Doc }) {
    if (doc.payment === null) return null;
    const p = doc.payment;
    return (
        <div className="rounded-md border border-line bg-bg px-4 py-3 text-[11px]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                {doc.labels.paymentMethod}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-4">
                <p className="font-medium text-ink">
                    {p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                </p>
                <p className="font-semibold tabular-nums text-ink">{formatMoney(p.amountCents)}</p>
            </div>
            <p className="text-muted">{p.at}</p>
        </div>
    );
}

function HowToPay({ doc, code = true }: { doc: Doc; code?: boolean }) {
    if (doc.instructions.length === 0) return null;
    return (
        <div className="flex items-center justify-between gap-6 rounded-md border border-line px-4 py-3">
            <div className="text-[11px] leading-relaxed">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {doc.labels.howToPay}
                </p>
                {doc.instructions.map((i) => (
                    <p key={i} className="mt-1 text-ink-soft">
                        {i}
                    </p>
                ))}
            </div>
            {code && doc.payUrl !== null ? (
                <div className="flex flex-col items-center gap-1">
                    <PayCode value={doc.payUrl} size={64} label={doc.labels.scanToPay} />
                    <span className="text-[9px] uppercase tracking-wider text-muted">
                        {doc.labels.scanToPay}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

function Stamp({ text }: { text: string }) {
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute right-12 top-40 rotate-[-14deg] rounded-md border-[3px] border-success px-4 py-1 font-display text-3xl font-bold uppercase tracking-widest text-success opacity-70"
        >
            {text}
        </span>
    );
}

function Footer({ doc }: { doc: Doc }) {
    return (
        <footer className="mt-auto flex items-end justify-between gap-6 border-t border-line pt-3 text-[10px] text-muted">
            <div>
                <p className="text-ink-soft">{doc.footer}</p>
                <p className="mt-0.5">
                    {doc.business.registration} · {doc.business.website}
                </p>
            </div>
            <p>{doc.labels.page}</p>
        </footer>
    );
}

function Classic({ doc }: { doc: Doc }) {
    return (
        <>
            <header className="flex items-start justify-between gap-6">
                <BrandBlock doc={doc} />
                <div className="text-right">
                    <p
                        style={{ color: doc.business.brandColor }}
                        className="font-display text-2xl font-bold uppercase tracking-[0.18em]"
                    >
                        {doc.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">#{doc.number}</p>
                </div>
            </header>
            <div
                style={{ backgroundColor: doc.business.brandColor }}
                className="mt-5 h-[3px] rounded-full"
            />
            <div className="mt-6 grid gap-6 @xl:grid-cols-[1fr_auto] @xl:gap-8">
                <Parties doc={doc} />
                <Meta doc={doc} columns={false} />
            </div>
            {doc.message !== null ? (
                <p className="mt-6 rounded-md bg-bg px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
                    {doc.message}
                </p>
            ) : null}
            <div className="mt-6">
                <LinesTable doc={doc} />
            </div>
            <div className="mt-4 grid grid-cols-1 items-start gap-6 @xl:grid-cols-[1fr_270px] @xl:gap-8">
                <div className="space-y-4">
                    <TaxSummary doc={doc} />
                    <PaymentBox doc={doc} />
                </div>
                <DocTotals lines={doc.totals} density="compact" />
            </div>
            <div className="mt-6">
                <HowToPay doc={doc} />
            </div>
        </>
    );
}

function Statement({ doc }: { doc: Doc }) {
    return (
        <>
            <header
                style={{ backgroundColor: doc.business.brandColor }}
                className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-4 px-6 py-6 @xl:-mx-12 @xl:-mt-12 @xl:px-12"
            >
                <BrandBlock doc={doc} inverse />
                <div className="text-right text-on-data">
                    <p className="font-display text-lg font-bold">
                        {doc.title} #{doc.number}
                    </p>
                    <p className="text-[11px] text-on-data/75">{doc.meta[1]?.value}</p>
                </div>
            </header>
            <section className="mt-8 flex flex-wrap items-stretch justify-between gap-6 rounded-lg border border-line bg-bg p-5">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                        {doc.headline.label}
                    </p>
                    <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
                        {formatMoney(doc.headline.cents)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                        {doc.meta[2]?.label} {doc.meta[2]?.value}
                    </p>
                    {doc.instructions.map((i) => (
                        <p
                            key={i}
                            className="mt-2 max-w-[300px] text-[11px] leading-relaxed text-ink-soft"
                        >
                            {i}
                        </p>
                    ))}
                </div>
                {doc.payUrl !== null ? (
                    <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-surface px-3 py-2">
                        <PayCode value={doc.payUrl} size={92} label={doc.labels.scanToPay} />
                        <span className="text-[9px] uppercase tracking-wider text-muted">
                            {doc.labels.scanToPay}
                        </span>
                    </div>
                ) : null}
            </section>
            <div className="mt-6">
                <Parties doc={doc} />
            </div>
            {doc.message !== null ? (
                <p className="mt-5 text-[11px] italic leading-relaxed text-ink-soft">
                    {doc.message}
                </p>
            ) : null}
            <div className="mt-6">
                <LinesTable doc={doc} />
            </div>
            <div className="mt-4 grid grid-cols-1 items-start gap-6 @xl:grid-cols-[1fr_270px] @xl:gap-8">
                <div className="space-y-4">
                    <PaymentBox doc={doc} />
                    <TaxSummary doc={doc} />
                </div>
                <DocTotals lines={doc.totals} density="compact" />
            </div>
        </>
    );
}

export function PrintedDocument({
    doc,
    template = "classic",
    className,
}: WebProps<PrintedDocumentProps>) {
    return (
        <div className={cx("@container mx-auto w-full max-w-[680px]", className)}>
            <article
                aria-label={`${doc.title} ${doc.number}`}
                className="relative flex min-h-[129.4cqw] w-full flex-col overflow-hidden rounded-sm bg-surface p-6 text-ink @xl:p-12 shadow-page"
            >
                {template === "classic" ? <Classic doc={doc} /> : <Statement doc={doc} />}
                {doc.stamp !== null ? <Stamp text={doc.stamp} /> : null}
                <div className="mt-8 flex flex-1 flex-col">
                    <Footer doc={doc} />
                </div>
            </article>
        </div>
    );
}
