import { type ListPageProps, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Choice } from "./Choice";
import { Empty } from "./Empty";
import { LoadFailed } from "./LoadFailed";
import { Icon } from "./Icon";
import type { WebProps } from "./props";
import { SearchField } from "./SearchField";
import { Skeleton } from "./Skeleton";

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
    state,
    onRetry,
    footer,
    className,
}: WebProps<ListPageProps<T, K>>) {
    const hasHeader =
        title !== undefined || summary !== undefined || action !== undefined || accessory;
    return (
        <div className={className}>
            {hasHeader ? (
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        {title !== undefined ? (
                            <h1 className="break-words font-display text-2xl font-bold text-ink">
                                {title}
                            </h1>
                        ) : null}
                        {summary !== undefined ? (
                            <p className="mt-0.5 text-sm text-muted">{summary}</p>
                        ) : null}
                    </div>
                    <div className="flex max-w-full flex-wrap items-center gap-3">
                        {accessory}
                        {action !== undefined ? (
                            <Button onPress={action.onPress} icon={<Icon name="plus" size={16} />}>
                                {action.label}
                            </Button>
                        ) : null}
                    </div>
                </header>
            ) : null}

            {segments !== undefined ? (
                <div className="mt-5">
                    <Choice
                        layout="segmented"
                        options={segments.items}
                        value={segments.active}
                        onChange={segments.onSelect}
                    />
                </div>
            ) : null}

            {search !== undefined ? (
                <div className="mt-4">
                    <SearchField
                        value={search.value}
                        onChange={search.onChange}
                        placeholder={search.placeholder}
                    />
                </div>
            ) : null}

            {banner !== undefined ? <div className="mt-4 space-y-3">{banner}</div> : null}

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                {head !== undefined ? (
                    <div className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                        {head}
                    </div>
                ) : null}
                {state === "loading" ? (
                    <Skeleton variant="row" count={4} label={strings.common.loading} />
                ) : state === "error" ? (
                    <LoadFailed
                        message={strings.ui.listError}
                        body={strings.ui.listErrorBody}
                        onRetry={onRetry}
                    />
                ) : rows.length === 0 ? (
                    typeof empty === "string" ? (
                        <Empty message={empty} />
                    ) : (
                        <Empty {...empty} />
                    )
                ) : (
                    rows.map((row) =>
                        onRowPress !== undefined ? (
                            <button
                                key={rowKey(row)}
                                type="button"
                                onClick={() => {
                                    onRowPress(row);
                                }}
                                className="block w-full border-b border-line-soft px-4 py-3 text-left text-sm transition last:border-0 hover:bg-bg hover:text-ink"
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
