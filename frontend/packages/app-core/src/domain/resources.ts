import { useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";
import {
    type Load,
    useAsyncAction,
    useBusinessQuery as useQuery,
    useLoad,
    useRemote,
} from "../hooks";
import { formatList } from "../format";
import { strings } from "../strings";
import type { Intent } from "../ui";

const s = strings.resources;

export interface ResourceRow {
    id: string;
    name: string;
    active: number | boolean;
}

export const RESOURCES_SQL = "SELECT id, name, active FROM resources ORDER BY lower(name), id";

export const RESOURCE_USERS_SQL = `
SELECT j.value AS resource_id, i.name FROM items i, json_each(i.resource_ids) j
WHERE i.active = 1 AND json_valid(i.resource_ids)
ORDER BY lower(i.name), i.id`;

/** The business's rooms and equipment from the replica, retired ones included. */
export function useResources(): ResourceRow[] {
    return useQuery<ResourceRow>(RESOURCES_SQL).data;
}

export function resourceName(
    rows: readonly ResourceRow[],
    id: string | null | undefined,
): string | null {
    if (id === null || id === undefined) return null;
    return rows.find((r) => r.id === id)?.name ?? null;
}

/** The ids of a service's pool that are still in service, in pool order. */
export function activePool(rows: readonly ResourceRow[], ids: readonly string[]): string[] {
    const active = new Set(rows.filter((r) => Boolean(r.active)).map((r) => r.id));
    return ids.filter((id) => active.has(id));
}

interface ResourceOut {
    id: string;
    name: string;
    active: boolean;
    upcoming: number;
}

interface ResourceForm {
    name: string;
    setName: (value: string) => void;
    error: string | null;
    busy: boolean;
    submit: () => void;
}

/** Adding a room, or renaming one; names are unique in the business whatever their case. */
export function useResourceForm(
    api: ApiLike,
    resource: { id: string; name: string } | null,
    onDone: () => void,
): ResourceForm {
    const [name, setName] = useState(resource?.name ?? "");
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<Attempt | null>(null);
    return {
        name,
        setName: (value) => {
            setName(value);
            setError(null);
        },
        error,
        busy,
        submit: () => {
            const trimmed = name.trim();
            if (trimmed === "") {
                setError(s.nameRequired);
                return;
            }
            const body = { name: trimmed };
            const idempotencyKey = attemptKey(key, { id: resource?.id ?? null, body });
            run(
                () =>
                    resource === null
                        ? api.post<ResourceOut>("/v1/resources", body, { idempotencyKey })
                        : api.patch<ResourceOut>(`/v1/resources/${resource.id}`, body, {
                              idempotencyKey,
                          }),
                {
                    onSuccess: () => {
                        key.current = null;
                        onDone();
                    },
                    errorMessage: (e) => failureMessage(e, s.saveError),
                },
            );
        },
    };
}

interface ResourceEntry {
    id: string;
    name: string;
    active: boolean;
    detail: string;
    upcoming: string;
    status: string;
    intent: Intent;
    toggleLabel: string;
    // the services that can book it, by name
    usedBy: string[];
    usedByLine: string;
}

function usedByLine(names: string[]): string {
    const [first, second] = names;
    if (first === undefined) return s.usedByNone;
    if (second === undefined || names.length === 2) return formatList(names);
    return s.usedByMore(first, second, names.length - 2);
}

interface ResourceSettings {
    load: Load;
    summary: string | undefined;
    entries: ResourceEntry[];
    toggle: (id: string) => void;
    toggling: string | null;
    error: string | null;
    // reads the upcoming counts again after a room is added or renamed
    refresh: () => void;
}

/** What the settings page lists: each room, whether it's in service and the visits that hold it. */
export function useResourceSettings(api: ApiLike): ResourceSettings {
    const [version, setVersion] = useState(0);
    const remote = useRemote(
        () => api.get<ResourceOut[]>("/v1/resources"),
        `resources:${String(version)}`,
    );
    const { busy, error, run } = useAsyncAction();
    const [toggling, setToggling] = useState<string | null>(null);
    const rows = remote.data ?? [];
    const users = useQuery<{ resource_id: string; name: string }>(RESOURCE_USERS_SQL).data;
    const load = useLoad([remote], rows.length === 0);
    const usedBy = (id: string): string[] =>
        users.filter((u) => u.resource_id === id).map((u) => u.name);
    return {
        load,
        summary: load.ready
            ? s.summary(rows.length, rows.filter((r) => !r.active).length)
            : undefined,
        entries: rows.map((r) => ({
            id: r.id,
            name: r.name,
            active: r.active,
            detail: r.active
                ? s.upcoming(r.upcoming)
                : r.upcoming > 0
                  ? s.offUpcoming(r.upcoming)
                  : s.off,
            upcoming: s.upcoming(r.upcoming),
            status: r.active ? s.inService : s.turnedOff,
            intent: r.active ? "neutral" : "warning",
            toggleLabel: r.active ? s.turnOff : s.turnOn,
            usedBy: usedBy(r.id),
            usedByLine: usedByLine(usedBy(r.id)),
        })),
        toggle: (id) => {
            const row = rows.find((r) => r.id === id);
            if (row === undefined) return;
            setToggling(id);
            run(() => api.patch(`/v1/resources/${id}`, { active: !row.active }), {
                onSuccess: () => {
                    setToggling(null);
                    setVersion((v) => v + 1);
                },
                errorMessage: (e) => {
                    setToggling(null);
                    return failureMessage(e, s.saveError);
                },
            });
        },
        toggling: busy ? toggling : null,
        error,
        refresh: () => {
            setVersion((v) => v + 1);
        },
    };
}
