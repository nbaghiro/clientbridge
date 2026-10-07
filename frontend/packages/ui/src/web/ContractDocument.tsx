import type { ContractDocumentProps, ContractSignature } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";
import { SignaturePad } from "./SignaturePad";

export function ContractDocument({
    issuer,
    title,
    meta,
    clauses,
    signature,
    density = "regular",
    className,
}: WebProps<ContractDocumentProps>) {
    const compact = density === "compact";
    return (
        <article
            className={cx(
                `rounded-md border border-line bg-surface text-ink shadow-card ${compact ? "px-6 py-6 text-[12px] leading-[1.55]" : "px-10 py-10 text-sm leading-relaxed max-sm:px-5 max-sm:py-6"}`,
                className,
            )}
        >
            <header className="border-b border-line pb-4">
                <p
                    className={`font-semibold uppercase tracking-wide text-muted ${compact ? "text-[10px]" : "text-xs"}`}
                >
                    {issuer}
                </p>
                <h2 className={`mt-1 font-display font-bold ${compact ? "text-base" : "text-xl"}`}>
                    {title}
                </h2>
                <p className={`mt-0.5 text-muted ${compact ? "text-[11px]" : "text-xs"}`}>{meta}</p>
            </header>
            {clauses.length > 0 ? (
                <ol className={compact ? "mt-4 space-y-3" : "mt-6 space-y-4"}>
                    {clauses.map((c, i) => (
                        <li key={`${String(i)}:${c.heading}`}>
                            {c.heading !== "" ? (
                                <h3 className="font-semibold text-ink">{c.heading}</h3>
                            ) : null}
                            {c.text !== "" ? (
                                <p className="mt-0.5 text-ink-soft">{c.text}</p>
                            ) : null}
                        </li>
                    ))}
                </ol>
            ) : null}
            {signature ? (
                <SignatureBlock
                    signature={signature}
                    compact={compact}
                    ruled={clauses.length > 0}
                />
            ) : null}
        </article>
    );
}

function SignatureBlock({
    signature,
    compact,
    ruled,
}: {
    signature: ContractSignature;
    compact: boolean;
    ruled: boolean;
}) {
    return (
        <section
            className={
                !ruled ? "mt-4" : `border-t border-line ${compact ? "mt-5 pt-4" : "mt-8 pt-6"}`
            }
        >
            <h3
                className={`font-semibold uppercase tracking-wide text-muted ${compact ? "text-[10px]" : "text-xs"}`}
            >
                {signature.heading}
            </h3>
            <div className="mt-2 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                    {signature.strokes ? (
                        <SignaturePad
                            strokes={signature.strokes}
                            label={signature.name}
                            height={compact ? 56 : 72}
                        />
                    ) : (
                        <p
                            aria-label={signature.name}
                            style={{
                                fontFamily:
                                    '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
                            }}
                            className={`flex items-end text-ink ${compact ? "h-14 text-2xl" : "h-[72px] text-3xl"}`}
                        >
                            {signature.name}
                        </p>
                    )}
                    <p className="mt-1 border-t border-ink/60 pt-1 font-medium">{signature.name}</p>
                </div>
                <dl className={`space-y-1 ${compact ? "text-[11px]" : "text-xs"}`}>
                    {signature.facts.map((f) => (
                        <div key={f.label} className="flex justify-between gap-3">
                            <dt className="text-muted">{f.label}</dt>
                            <dd className="whitespace-nowrap text-right tabular-nums text-ink-soft">
                                {f.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}
