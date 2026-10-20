import { type TableCount, countsQuery } from "@clientbridge/sync";
import type { SyncStatus } from "@powersync/common";
import { usePowerSync } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { useSyncStatus } from "./domain/sync";

interface OutboxCounts {
    waiting: number;
    sending: number;
    awaiting: number;
    rejected: number;
    oldest: string | null;
    replicationDelayMs: string | null;
}

interface ClientState {
    status: SyncStatus;
    queue: OutboxCounts | null;
    tables: TableCount[];
    totalRows: number;
    refresh: () => void;
}

type SyncFacts = Pick<
    SyncStatus,
    | "connected"
    | "connecting"
    | "hasSynced"
    | "lastSyncedAt"
    | "downloading"
    | "uploading"
    | "downloadError"
    | "uploadError"
    | "downloadProgress"
>;

interface DebugFact {
    label: string;
    value: string;
    tone: "good" | "bad" | "plain";
}

// the same rows the sync banner counts: an accepted edit leaves once the replica has caught up
const OUTBOX_SQL = `
SELECT
    COALESCE(SUM(o.state = 'queued'), 0) AS waiting,
    COALESCE(SUM(o.state = 'sending'), 0) AS sending,
    COALESCE(SUM(o.state = 'accepted'), 0) AS awaiting,
    COALESCE(SUM(o.state = 'rejected'), 0) AS rejected,
    MIN(o.created_at) AS oldest,
    (SELECT value FROM device_prefs WHERE id = 'sync.replicationDelayMs') AS replicationDelayMs
FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id
WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision`;

export function useClientState(pollMs = 1500): ClientState {
    const db = usePowerSync();
    const status = useSyncStatus();
    const [queue, setQueue] = useState<ClientState["queue"]>(null);
    const [tables, setTables] = useState<TableCount[]>([]);

    const refresh = useCallback((): void => {
        db.get<OutboxCounts>(OUTBOX_SQL)
            .then(setQueue)
            .catch(() => undefined);
        db.getAll<TableCount>(countsQuery())
            .then((rows) => {
                setTables(rows.filter((r) => r.rows > 0).sort((a, b) => b.rows - a.rows));
            })
            .catch(() => undefined); // before the first sync the tables may not exist yet — ignore
    }, [db]);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, pollMs);
        return () => {
            clearInterval(id);
        };
    }, [refresh, pollMs, status.lastSyncedAt]);

    return {
        status,
        queue,
        tables,
        totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
        refresh,
    };
}

function clockTime(at: Date): string {
    return [at.getHours(), at.getMinutes(), at.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
}

function ago(at: Date, now: number): string {
    const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
    if (seconds < 60) return `${String(seconds)}s ago`;
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? `${String(minutes)}m ago` : `${String(Math.round(minutes / 60))}h ago`;
}

/** The debug panel's sync and outbox rows, worded the same on web and mobile. */
export function debugFacts(
    status: SyncFacts,
    queue: OutboxCounts | null,
    now: number = Date.now(),
): DebugFact[] {
    const facts: DebugFact[] = [
        status.connected
            ? { label: "connection", value: "connected", tone: "good" }
            : status.connecting
              ? { label: "connection", value: "connecting", tone: "plain" }
              : { label: "connection", value: "offline", tone: "bad" },
        status.lastSyncedAt
            ? {
                  label: "last synced",
                  value: `${clockTime(status.lastSyncedAt)} (${ago(status.lastSyncedAt, now)})`,
                  tone: "plain",
              }
            : {
                  label: "last synced",
                  value: status.hasSynced ? "yes" : "not yet",
                  tone: "plain",
              },
    ];
    const progress = status.downloadProgress;
    facts.push({
        label: "download",
        value: !status.downloading
            ? "idle"
            : progress
              ? `${String(Math.round(progress.downloadedFraction * 100))}% (${String(progress.downloadedOperations)} of ${String(progress.totalOperations)} ops)`
              : "downloading",
        tone: "plain",
    });
    facts.push({ label: "upload", value: status.uploading ? "uploading" : "idle", tone: "plain" });
    if (status.downloadError)
        facts.push({ label: "download error", value: status.downloadError.message, tone: "bad" });
    if (status.uploadError)
        facts.push({ label: "upload error", value: status.uploadError.message, tone: "bad" });
    if (queue === null) {
        facts.push({ label: "offline edits", value: "unknown", tone: "plain" });
        return facts;
    }
    const outgoing = queue.waiting + queue.sending;
    facts.push({
        label: "offline edits",
        value:
            outgoing === 0
                ? "none waiting"
                : `${String(outgoing)} waiting${queue.oldest ? `, oldest ${clockTime(new Date(queue.oldest))}` : ""}`,
        tone: outgoing === 0 ? "good" : "plain",
    });
    facts.push({
        label: "accepted, not synced back",
        value: String(queue.awaiting),
        tone: "plain",
    });
    facts.push({
        label: "rejected",
        value: String(queue.rejected),
        tone: queue.rejected > 0 ? "bad" : "plain",
    });
    const delay = queue.replicationDelayMs === null ? NaN : Number(queue.replicationDelayMs);
    facts.push({
        label: "replication delay",
        value: Number.isFinite(delay) ? `${(delay / 1000).toFixed(1)}s` : "not measured",
        tone: "plain",
    });
    return facts;
}
