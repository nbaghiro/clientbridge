import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
    adminLabel,
    adminStatusIntent,
    formatDate,
    formatTime,
    strings,
    type useAdminFilters,
} from "@clientbridge/app-core/public";
import {
    Badge,
    Button,
    Empty,
    Loading,
    LoadFailed,
    Panel,
    TextField,
    Select,
} from "@clientbridge/ui";
import { config } from "../config";

export function Resource<T>({
    state,
    children,
}: {
    state: { data: T | null; error: number | null; refresh: () => void };
    children: (data: T) => ReactNode;
}) {
    useEffect(() => {
        if (state.error === 401) window.location.replace(new URL("/admin-login", config.webUrl));
        if (state.error === 403) window.location.reload();
    }, [state.error]);
    if (state.error !== null) return <LoadFailed onRetry={state.refresh} />;
    if (state.data === null) return <Loading />;
    return <>{children(state.data)}</>;
}

export function Records<T>({
    items,
    columns,
}: {
    items: T[];
    columns: { label: string; render: (row: T) => ReactNode }[];
}) {
    if (!items.length) return <Empty message={strings.admin.noResults} />;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-bg text-muted">
                    <tr>
                        {columns.map((c) => (
                            <th key={c.label} className="whitespace-nowrap px-4 py-3 font-medium">
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-line">
                    {items.map((row, i) => (
                        <tr key={i} className="hover:bg-bg/60">
                            {columns.map((c) => (
                                <td key={c.label} className="px-4 py-4 align-top">
                                    {c.render(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function RecordLink({ to, children }: { to: string; children: ReactNode }) {
    return (
        <Link
            to={to}
            className="font-medium text-accent underline-offset-4 hover:underline break-words"
        >
            {children}
        </Link>
    );
}
export function Identifier({ value }: { value: string | null }) {
    return (
        <span className="break-all font-mono text-xs text-muted">
            {value ?? strings.admin.none}
        </span>
    );
}
export function When({ value, zone = "UTC" }: { value: string | null; zone?: string }) {
    return value ? (
        <span className="whitespace-nowrap">
            {formatDate(new Date(value), zone)}
            <span className="block text-xs text-muted">{formatTime(new Date(value), zone)}</span>
        </span>
    ) : (
        strings.admin.none
    );
}
export function Facts({ items }: { items: [string, ReactNode][] }) {
    return (
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {items.map(([label, value]) => (
                <div key={label} className="min-w-0">
                    <dt className="mb-1 text-xs text-muted">{label}</dt>
                    <dd className="break-words text-sm">{value ?? strings.admin.none}</dd>
                </div>
            ))}
        </dl>
    );
}
export function Filters({
    filters,
    placeholder,
    scoped = false,
    statuses = [],
}: {
    filters: ReturnType<typeof useAdminFilters>;
    placeholder: string;
    scoped?: boolean;
    statuses?: string[];
}) {
    return (
        <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
                <TextField
                    label={strings.admin.search}
                    value={filters.query}
                    onChange={filters.setQuery}
                    placeholder={placeholder}
                />
            </div>
            {scoped ? (
                <div className="w-60">
                    <TextField
                        label={strings.admin.businessFilter}
                        value={filters.business}
                        onChange={filters.setBusiness}
                        placeholder={strings.admin.allBusinesses}
                    />
                </div>
            ) : null}
            {statuses.length ? (
                <div className="w-44">
                    <Select
                        label={strings.admin.status}
                        value={filters.status}
                        onChange={filters.setStatus}
                        options={[
                            { key: "", label: strings.admin.allStatuses },
                            ...statuses.map((key) => ({ key, label: adminLabel(key) })),
                        ]}
                    />
                </div>
            ) : null}
        </div>
    );
}
export function Pagination({
    filters,
    hasMore,
}: {
    filters: ReturnType<typeof useAdminFilters>;
    hasMore: boolean;
}) {
    return (
        <div className="flex justify-end gap-2 border-t border-line p-3">
            <Button variant="outline" disabled={filters.offset === 0} onPress={filters.previous}>
                {strings.admin.previous}
            </Button>
            <Button variant="outline" disabled={!hasMore} onPress={filters.next}>
                {strings.admin.next}
            </Button>
        </div>
    );
}
export function RecordPanel({ title, children }: { title?: string; children: ReactNode }) {
    return (
        <Panel {...(title ? { title } : {})} flush>
            {children}
        </Panel>
    );
}

export function RecordStatus({ value }: { value: string }) {
    return <Badge label={adminLabel(value)} intent={adminStatusIntent(value)} />;
}
