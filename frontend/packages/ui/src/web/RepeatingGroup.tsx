import { type RepeatingGroupProps, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { type WebProps, cx } from "./props";

export function RepeatingGroup<T>({
    title,
    hint,
    items,
    itemLabel,
    addLabel,
    onAdd,
    onRemove,
    max,
    children,
    className,
}: WebProps<RepeatingGroupProps<T>>) {
    return (
        <section className={cx("space-y-3 border-t border-line-soft pt-4", className)}>
            <div>
                <h3 className="font-display text-base font-bold text-ink">{title}</h3>
                {hint !== undefined ? <p className="text-sm text-muted">{hint}</p> : null}
            </div>
            {items.map((item, i) => {
                const label = itemLabel(i + 1);
                return (
                    <div key={i} className="rounded-lg border border-line p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold text-ink">{label}</span>
                            <Button
                                size="sm"
                                variant="quiet"
                                label={strings.ui.removeItem(label)}
                                icon="trash"
                                onPress={() => {
                                    onRemove(i);
                                }}
                            >
                                {strings.ui.remove}
                            </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">{children(item, i)}</div>
                    </div>
                );
            })}
            {items.length < max ? (
                <Button variant="outline" icon="plus" onPress={onAdd}>
                    {addLabel}
                </Button>
            ) : null}
        </section>
    );
}
