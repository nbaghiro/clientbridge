import { type LineItemProps, type Tag, formatMoney } from "@clientbridge/app-core/public";

import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";
import { Stepper } from "./Stepper";

export function LineItem({
    title,
    meta,
    leading,
    quantity,
    count,
    cents,
    originalCents,
    tag,
    onPress,
    pressLabel,
    onRemove,
    removeLabel,
    selected = false,
    className,
}: WebProps<LineItemProps>) {
    const body = (
        <>
            <span className="block truncate text-sm font-medium text-ink">{title}</span>
            <MetaLine tag={tag ?? null} meta={meta} />
        </>
    );
    const stepper =
        quantity !== undefined ? (
            <div className="mt-1.5">
                <Stepper
                    value={quantity.value}
                    onChange={quantity.onChange}
                    min={0}
                    label={quantity.label}
                />
            </div>
        ) : null;
    return (
        <div
            className={cx(
                `flex items-center gap-3 py-2.5 ${selected ? "-mx-2 rounded-md bg-accent-weak/60 px-2" : ""}`,
                className,
            )}
        >
            {leading}
            {onPress !== undefined ? (
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={onPress}
                        aria-label={pressLabel}
                        className="block w-full min-w-0 rounded-sm text-left hover:opacity-80"
                    >
                        {body}
                    </button>
                    {stepper}
                </div>
            ) : (
                <div className="min-w-0 flex-1">
                    {body}
                    {stepper}
                </div>
            )}
            {count !== undefined && count > 1 ? (
                <span className="text-sm tabular-nums text-muted">{count} ×</span>
            ) : null}
            <span className="min-w-20 shrink-0 text-right">
                {originalCents !== undefined &&
                originalCents !== null &&
                originalCents !== cents ? (
                    <span className="block text-xs tabular-nums text-muted line-through">
                        {formatMoney(originalCents)}
                    </span>
                ) : null}
                <span className="block text-sm font-semibold tabular-nums text-ink">
                    {formatMoney(cents)}
                </span>
            </span>
            {onRemove !== undefined ? (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={removeLabel}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-bg hover:text-danger"
                >
                    <Icon name="x" size={15} />
                </button>
            ) : null}
        </div>
    );
}

function MetaLine({ tag, meta }: { tag: Tag | null; meta: string | undefined }) {
    const hasMeta = meta !== undefined && meta !== "";
    if (tag === null && !hasMeta) return null;
    return (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {tag !== null ? (
                <span className="shrink-0 whitespace-nowrap">
                    <Badge label={tag.label} intent={tag.intent} />
                </span>
            ) : null}
            {hasMeta ? <span className="truncate text-xs text-muted">{meta}</span> : null}
        </span>
    );
}
