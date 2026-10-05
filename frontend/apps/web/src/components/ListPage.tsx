import type { ListPageProps } from "@clientbridge/app-core";

import { Empty } from "./Empty";
import { IconPlus, IconSearch } from "./Icons";

export function ListPage<T, K extends string = string>({
    title,
    summary,
    action,
    accessory,
    segments,
    search,
    banner,
    head,
    rows,
    rowKey,
    renderRow,
    onRowPress,
    empty,
    footer,
}: ListPageProps<T, K>) {
    const hasHeader =
        title !== undefined || summary !== undefined || action !== undefined || accessory;
    return (
        <div>
            {hasHeader ? (
                <header className="flex items-center justify-between gap-4">
                    <div>
                        {title !== undefined ? (
                            <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
                        ) : null}
                        {summary !== undefined ? (
                            <p className="mt-0.5 text-sm text-muted">{summary}</p>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                        {accessory}
                        {action !== undefined ? (
                            <button
                                type="button"
                                onClick={action.onPress}
                                className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                            >
                                <IconPlus className="h-4 w-4" /> {action.label}
                            </button>
                        ) : null}
                    </div>
                </header>
            ) : null}

            {segments !== undefined ? (
                <div className="mt-5 inline-flex rounded-md border border-line bg-surface p-1 text-sm">
                    {segments.items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                                segments.onSelect(item.key);
                            }}
                            className={`rounded px-4 py-1.5 font-medium transition ${
                                item.key === segments.active
                                    ? "bg-accent text-accent-ink"
                                    : "text-ink-soft hover:bg-bg"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {search !== undefined ? (
                <div className="relative mt-4">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                        value={search.value}
                        onChange={(e) => {
                            search.onChange(e.target.value);
                        }}
                        placeholder={search.placeholder}
                        className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-hidden placeholder:text-muted focus:border-accent"
                    />
                </div>
            ) : null}

            {banner}

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                {head !== undefined ? (
                    <div className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                        {head}
                    </div>
                ) : null}
                {rows.length === 0 ? (
                    <Empty message={empty} />
                ) : (
                    rows.map((row) =>
                        onRowPress !== undefined ? (
                            <button
                                key={rowKey(row)}
                                type="button"
                                onClick={() => {
                                    onRowPress(row);
                                }}
                                className="block w-full border-b border-line-soft px-4 py-3 text-left text-sm transition last:border-0 hover:bg-bg"
                            >
                                {renderRow(row)}
                            </button>
                        ) : (
                            <div
                                key={rowKey(row)}
                                className="border-b border-line-soft px-4 py-3 text-sm last:border-0"
                            >
                                {renderRow(row)}
                            </div>
                        ),
                    )
                )}
            </div>
            {footer}
        </div>
    );
}
