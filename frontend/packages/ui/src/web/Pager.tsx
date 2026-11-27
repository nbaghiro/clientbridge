import type { PagerProps } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { type WebProps, cx } from "./props";

export function Pager({
    onPrevious,
    onNext,
    previousLabel,
    nextLabel,
    className,
}: WebProps<PagerProps>) {
    if (onPrevious === null && onNext === null) return null;
    return (
        <div className={cx("flex justify-end gap-2", className)}>
            {onPrevious !== null ? (
                <Button size="sm" variant="outline" onPress={onPrevious}>
                    {previousLabel}
                </Button>
            ) : null}
            {onNext !== null ? (
                <Button size="sm" variant="outline" onPress={onNext}>
                    {nextLabel}
                </Button>
            ) : null}
        </div>
    );
}
