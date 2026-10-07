import { type ItemTileProps, formatMoney, strings } from "@clientbridge/app-core/public";
import { cssVar, tint } from "@clientbridge/tokens";

import { Badge } from "./Badge";
import { ItemImage } from "./ItemImage";
import { type WebProps, cx } from "./props";

export function ItemTile({
    name,
    imageSrc,
    color,
    cents,
    meta,
    tag,
    count = 0,
    onPress,
    disabled = false,
    variant = "tile",
    className,
}: WebProps<ItemTileProps>) {
    const tone = color ?? cssVar("accent");
    if (variant === "card") {
        return (
            <button
                type="button"
                onClick={onPress}
                disabled={disabled}
                aria-label={count > 0 ? strings.ui.onTicket(name, count) : name}
                className={cx(
                    "group flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-card transition hover:border-accent-line disabled:opacity-60",
                    className,
                )}
            >
                <span className="relative block aspect-[4/3] w-full overflow-hidden bg-bg">
                    {imageSrc !== null ? (
                        <img
                            src={imageSrc}
                            alt=""
                            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                        />
                    ) : (
                        <span
                            className="flex h-full w-full items-center justify-center text-3xl font-semibold"
                            style={{ backgroundColor: tint(tone, 12), color: tone }}
                        >
                            {name.trim().charAt(0).toUpperCase()}
                        </span>
                    )}
                    {tag ? (
                        <span className="absolute left-2 top-2">
                            <Badge label={tag.label} intent={tag.intent} />
                        </span>
                    ) : null}
                    {count > 0 ? (
                        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                            {count}
                        </span>
                    ) : null}
                </span>
                <span className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
                    <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">
                        {name}
                    </span>
                    <span className="mt-auto flex items-baseline justify-between gap-2 pt-2">
                        <span className="truncate text-xs text-muted">{meta}</span>
                        <span className="text-sm font-semibold text-ink">
                            {cents === null ? null : formatMoney(cents)}
                        </span>
                    </span>
                </span>
            </button>
        );
    }
    return (
        <button
            type="button"
            onClick={onPress}
            disabled={disabled}
            aria-label={count > 0 ? strings.ui.onTicket(name, count) : name}
            className={cx(
                `relative flex min-h-[112px] min-w-0 flex-col rounded-lg border bg-surface p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                    count > 0
                        ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                        : "border-line hover:border-accent-line hover:bg-bg hover:text-ink"
                }`,
                className,
            )}
        >
            <span className="flex items-start justify-between gap-2">
                <ItemImage src={imageSrc} name={name} color={color} size={36} />
                {count > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                        {count}
                    </span>
                ) : tag ? (
                    <Badge label={tag.label} intent={tag.intent} />
                ) : null}
            </span>
            <span className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-ink">
                {name}
            </span>
            <span className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
                <span className="truncate text-xs text-muted">{meta}</span>
                <span className="text-sm font-semibold text-ink">
                    {cents === null ? null : formatMoney(cents)}
                </span>
            </span>
        </button>
    );
}
