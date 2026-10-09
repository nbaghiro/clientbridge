import {
    type ButtonVariant,
    type ChecklistItem,
    type ChecklistProps,
    type UiAction,
    strings,
} from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function Checklist({ items, label, className }: WebProps<ChecklistProps>) {
    return (
        <ul aria-label={label} className={cx("divide-y divide-line-soft", className)}>
            {items.map((item: ChecklistItem) => (
                <li key={item.key} className="flex items-center gap-3 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-soft">
                        {item.done ? (
                            <Icon name="checkCircle" size={22} />
                        ) : item.attention ? (
                            <Icon name="alert" size={22} />
                        ) : (
                            <span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-dashed border-line" />
                        )}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p
                            className={`text-sm font-medium ${item.done ? "text-muted" : "text-ink"}`}
                        >
                            {item.label}
                            {item.done ? <span className="sr-only"> {strings.ui.done}</span> : null}
                        </p>
                        {item.hint !== undefined ? (
                            <p
                                className={`mt-0.5 text-xs ${item.attention ? "text-warn-fg" : "text-muted"}`}
                            >
                                {item.hint}
                            </p>
                        ) : null}
                    </div>
                    {item.action !== undefined ? (
                        <ActionButton
                            action={item.action}
                            variant={item.done ? "quiet" : item.attention ? "primary" : "outline"}
                        />
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

function ActionButton({ action, variant }: { action: UiAction; variant: ButtonVariant }) {
    return (
        <Button size="sm" variant={variant} onPress={action.onPress}>
            {action.label}
        </Button>
    );
}
