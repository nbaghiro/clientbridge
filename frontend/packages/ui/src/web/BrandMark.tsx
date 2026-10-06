import { type BrandMarkProps, strings } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";

const WORD: Record<string, string> = {
    visa: "VISA",
    mastercard: "MC",
    amex: "AMEX",
    discover: "DISC",
    interac: "INTERAC",
};

export function BrandMark({ method, brand, size = "md" }: BrandMarkProps) {
    const box = size === "sm" ? "h-6 w-9 text-[9px]" : "h-8 w-12 text-[10px]";
    return (
        <span
            aria-hidden
            className={`inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-surface2 font-bold tracking-wide text-ink-soft ${box}`}
        >
            {method === "bank_eft" ? (
                <Icon name="bank" size={size === "sm" ? 14 : 17} />
            ) : (
                (WORD[method === "interac" ? "interac" : (brand ?? "")] ?? strings.ui.cardFallback)
            )}
        </span>
    );
}
