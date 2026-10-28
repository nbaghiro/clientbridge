import { type SheetHeaderProps, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { type WebProps, cx } from "./props";

export function SheetHeader({
    title,
    subtitle,
    onClose,
    closeLabel,
    actions,
    className,
}: WebProps<SheetHeaderProps>) {
    return (
        <div className={cx("mb-4 flex items-center gap-3", className)}>
            <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-bold text-ink">{title}</h2>
                {subtitle !== undefined ? (
                    <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
                ) : null}
            </div>
            {actions}
            {onClose !== undefined ? (
                <Button variant="quiet" size="sm" onPress={onClose}>
                    {closeLabel ?? strings.common.cancel}
                </Button>
            ) : null}
        </div>
    );
}
