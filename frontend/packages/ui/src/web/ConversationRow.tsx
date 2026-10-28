import type { ConversationRowProps } from "@clientbridge/app-core/public";

import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { type WebProps, cx } from "./props";

export function ConversationRow({
    name,
    src,
    preview,
    at,
    unread,
    selected = false,
    tag,
    onPress,
    className,
}: WebProps<ConversationRowProps>) {
    const bold = unread > 0;
    return (
        <button
            type="button"
            onClick={onPress}
            aria-current={selected ? true : undefined}
            className={cx(
                `flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-left transition ${
                    selected ? "bg-accent-weak text-ink" : "hover:bg-bg hover:text-ink"
                }`,
                className,
            )}
        >
            <Avatar name={name} src={src} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span
                        className={`flex-1 truncate text-sm text-ink ${bold ? "font-bold" : "font-semibold"}`}
                    >
                        {name}
                    </span>
                    <span
                        className={`shrink-0 text-xs ${bold ? "font-semibold text-accent" : "text-muted"}`}
                    >
                        {at}
                    </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                    <span className={`flex-1 truncate text-xs ${bold ? "text-ink" : "text-muted"}`}>
                        {preview}
                    </span>
                    {unread > 0 ? <Badge variant="count" label={unread} /> : null}
                </span>
                {tag !== undefined ? (
                    <span className="mt-1.5 inline-block">
                        <Badge label={tag.label} intent={tag.intent} />
                    </span>
                ) : null}
            </span>
        </button>
    );
}
