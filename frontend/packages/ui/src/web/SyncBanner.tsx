import type { SyncBannerProps } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

const ICON = { offline: "cloudOff", syncing: "refresh", error: "alert" } as const;

export function SyncBanner({
    state,
    title,
    detail,
    action,
    variant = "strip",
    children,
    className,
}: WebProps<SyncBannerProps>) {
    const tone =
        state === "error"
            ? "bg-danger-bg text-danger-fg"
            : state === "offline"
              ? "bg-warn-bg text-warn-fg"
              : "bg-accent-weak text-accent-strong";
    if (variant === "strip") {
        return (
            <div
                role="status"
                className={cx(`flex items-center gap-2.5 px-5 py-2 text-sm ${tone}`, className)}
            >
                <Icon name={ICON[state]} size={16} />
                <span className="font-semibold">{title}</span>
                {detail !== undefined ? <span className="truncate">{detail}</span> : null}
                {action !== undefined ? (
                    <span className="ml-auto shrink-0">
                        <Button size="sm" variant="link" onPress={action.onPress}>
                            {action.label}
                        </Button>
                    </span>
                ) : null}
            </div>
        );
    }
    return (
        <div
            role="status"
            className={cx(
                "overflow-hidden rounded-lg border border-line bg-surface shadow-card",
                className,
            )}
        >
            <div className={`flex items-start gap-3 px-5 py-4 ${tone}`}>
                <span className="mt-0.5">
                    <Icon name={ICON[state]} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-bold">{title}</p>
                    {detail !== undefined ? <p className="mt-0.5 text-sm">{detail}</p> : null}
                </div>
                {action !== undefined ? (
                    <Button size="sm" variant="outline" onPress={action.onPress}>
                        {action.label}
                    </Button>
                ) : null}
            </div>
            {children !== undefined ? <div className="px-5 py-4">{children}</div> : null}
        </div>
    );
}
