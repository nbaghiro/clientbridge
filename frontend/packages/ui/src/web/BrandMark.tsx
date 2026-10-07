import { type BrandMarkProps, strings } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

const WORD: Record<string, string> = {
    visa: "VISA",
    mastercard: "MC",
    amex: "AMEX",
    discover: "DISC",
    interac: "INTERAC",
};

export function BrandMark({ method, brand, size = "md", className }: WebProps<BrandMarkProps>) {
    const word = WORD[method === "interac" ? "interac" : (brand ?? "")] ?? strings.ui.cardFallback;
    const long = word.length > 4;
    const box =
        size === "sm"
            ? `h-6 w-9 ${long ? "text-[7px]" : "text-[9px]"}`
            : `h-8 w-12 ${long ? "text-[8px]" : "text-[10px]"}`;
    return (
        <span
            aria-hidden
            className={cx(
                `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface2 font-bold text-ink-soft ${long ? "" : "tracking-wide"} ${box}`,
                className,
            )}
        >
            {method === "bank_eft" ? <Icon name="bank" size={size === "sm" ? 14 : 17} /> : word}
        </span>
    );
}
