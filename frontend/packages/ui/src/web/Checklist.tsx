import { type ChecklistProps, strings, type ChecklistItem } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Icon } from "./Icon";

export function Checklist({ items, label }: ChecklistProps) {
    return (
        <ul aria-label={label} className="divide-y divide-line-soft">
            {items.map((item: ChecklistItem) => (
                <li key={item.key} className="flex items-center gap-3 py-3">
                    <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                            item.done
                                ? "bg-ok-bg text-ok-fg"
                                : item.attention
                                  ? "bg-warn-bg text-warn-fg"
                                  : "border-2 border-dashed border-line text-transparent"
                        }`}
                    >
                        {item.done ? (
                            <Icon name="check" size={14} />
                        ) : item.attention ? (
                            <Icon name="alert" size={13} />
                        ) : null}
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
                        <Button
                            size="sm"
                            variant={item.done ? "quiet" : item.attention ? "primary" : "outline"}
                            onPress={item.action.onPress}
                        >
                            {item.action.label}
                        </Button>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}
