import { type StarsProps, strings } from "@clientbridge/app-core/public";

const SIZE = { sm: "text-base", md: "text-lg", lg: "text-3xl" } as const;
const SCALE = [1, 2, 3, 4, 5] as const;

export function Stars({ value, onSelect, size = "md" }: StarsProps) {
    if (onSelect === undefined) {
        return (
            <span
                role="img"
                aria-label={strings.common.ratingOf(value)}
                className={`leading-none ${SIZE[size]}`}
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
        <div role="radiogroup" className="flex gap-1">
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
