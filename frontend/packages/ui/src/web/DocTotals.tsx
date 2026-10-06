import { type DocTotalsProps, formatMoney, type DocTotalLine } from "@clientbridge/app-core/public";

export function DocTotals({ lines, density = "regular" }: DocTotalsProps) {
    const pad = density === "compact" ? "py-1" : "py-1.5";
    return (
        <dl className="text-sm">
            {lines.map((line: DocTotalLine) => {
                const ruled = line.kind === "total" || line.kind === "balance";
                const amount =
                    (line.kind === "credit" || line.kind === "deduction") && line.cents !== 0
                        ? `−${formatMoney(line.cents)}`
                        : formatMoney(line.cents);
                return (
                    <div
                        key={line.key}
                        className={`flex items-baseline justify-between gap-4 ${pad} ${ruled ? "mt-1 border-t border-line pt-2.5" : ""}`}
                    >
                        <dt className={ruled ? "font-semibold text-ink" : "text-muted"}>
                            {line.label}
                            {line.hint !== undefined ? (
                                <span className="ml-1.5 text-xs font-normal text-muted">
                                    {line.hint}
                                </span>
                            ) : null}
                        </dt>
                        <dd
                            className={`whitespace-nowrap tabular-nums ${
                                line.kind === "balance"
                                    ? "font-display text-xl font-bold text-ink"
                                    : line.kind === "total"
                                      ? "font-semibold text-ink"
                                      : line.kind === "credit"
                                        ? "font-medium text-ok-fg"
                                        : "font-medium text-ink-soft"
                            }`}
                        >
                            {amount}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}
