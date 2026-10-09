import type { Fact, FactListProps } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function FactList({ facts, label, className }: WebProps<FactListProps>) {
    return (
        <ul aria-label={label} className={cx("space-y-3", className)}>
            {facts.map((f: Fact) => (
                <li key={f.key} className="flex items-start gap-3">
                    <Icon name={f.icon} size={20} className="text-ink-soft" />
                    <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{f.title}</span>
                        {f.detail !== undefined ? (
                            <span className="block text-xs text-muted">{f.detail}</span>
                        ) : null}
                    </span>
                </li>
            ))}
        </ul>
    );
}
