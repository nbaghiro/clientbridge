import { type StarsProps, strings } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

const SIZE = { sm: "text-base", md: "text-lg", lg: "text-3xl" } as const;
const SCALE = [1, 2, 3, 4, 5] as const;

export function Stars({ value, onSelect, size = "md", className }: WebProps<StarsProps>) {
    if (onSelect === undefined) {
        return (
            <span
                role="img"
                aria-label={strings.common.ratingOf(value)}
                className={cx(`leading-none ${SIZE[size]}`, className)}
            >
                {SCALE.map((n) => (
                    <span key={n} className={n <= value ? "text-accent" : "text-line"}>
                        ★
                    </span>
                ))}
            </span>
        );
    }
    return (
        <div role="radiogroup" className={cx("flex gap-1", className)}>
            {SCALE.map((n) => (
                <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === value}
                    aria-label={strings.common.stars(n)}
                    onClick={() => {
                        onSelect(n);
                    }}
                    className={`leading-none transition ${SIZE[size]} ${
                        n <= value ? "text-accent" : "text-line hover:text-accent-line"
                    }`}
                >
                    ★
                </button>
            ))}
        </div>
    );
}
