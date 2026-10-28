import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";
import {
    formatDate,
    formatDateTime,
    parseTimestamp,
    parseWallDateTime,
    useBusinessZone,
} from "../datetime";
import { formatList } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { useBusinessName } from "./business";
import { useReplicaLoad } from "./sync";

const b = strings.broadcasts;

// The newest consent row per client; no row means the client was never asked.
export const LATEST_CONSENTS_SQL = `
SELECT k.client_id, k.status, k.source, k.created_at, k.expires_at
FROM consents k
WHERE NOT EXISTS (
    SELECT 1 FROM consents n
    WHERE n.client_id = k.client_id
      AND (n.created_at > k.created_at OR (n.created_at = k.created_at AND n.id > k.id))
)`;

// Clients whose newest STOP or START reply was STOP: only their own START reply lifts it.
export const TEXTS_STOPPED_SQL = `
SELECT k.client_id, k.created_at
FROM consents k
WHERE k.source = 'reply' AND k.status = 'withdrawn' AND NOT EXISTS (
    SELECT 1 FROM consents n
    WHERE n.client_id = k.client_id AND n.source = 'reply'
      AND (n.created_at > k.created_at OR (n.created_at = k.created_at AND n.id > k.id))
)`;

export const AUDIENCE_CLIENTS_SQL = `
SELECT id, name, phone, tags FROM clients
WHERE status = 'active' ORDER BY name COLLATE NOCASE`;

export const BROADCASTS_SQL = `
SELECT b.id, b.name, b.body, b.audience, b.status, b.scheduled_at, b.created_at,
       b.recipient_count, b.excluded_count,
       (SELECT COUNT(*) FROM messages m
        WHERE m.broadcast_id = b.id AND m.status IN ('sent', 'delivered', 'read')) AS delivered_count,
       (SELECT COUNT(DISTINCT r.thread_id) FROM messages r
        WHERE r.direction = 'in' AND r.created_at >= b.created_at
          AND r.thread_id IN (SELECT thread_id FROM messages WHERE broadcast_id = b.id))
           AS reply_count,
       (SELECT COUNT(DISTINCT k.client_id) FROM consents k
        JOIN threads t ON t.client_id = k.client_id
        WHERE k.status = 'withdrawn' AND k.created_at >= b.created_at
          AND t.id IN (SELECT thread_id FROM messages WHERE broadcast_id = b.id)) AS opt_out_count
FROM broadcasts b
ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC`;

interface ConsentRow {
    client_id: string;
    status: string;
    source: string;
    created_at: string;
    expires_at: string | null;
}

interface AudienceClient {
    id: string;
    name: string;
    phone: string | null;
    tags: string | null;
}

interface BroadcastRow {
    id: string;
    name: string;
    body: string | null;
    audience: string | null;
    status: string;
    scheduled_at: string | null;
    created_at: string;
    recipient_count: number;
    excluded_count: number;
    delivered_count: number;
    reply_count: number;
    opt_out_count: number;
}

type ConsentState = "express" | "implied" | "none" | "opted_out";

export interface MarketingConsent {
    state: ConsentState;
    source: string | null;
    at: string | null;
    expiresAt: string | null;
}

/** Mirrors the server's check: agreed, or implied consent that hasn't lapsed. */
export function consentOf(row: ConsentRow | undefined, now: Date = new Date()): MarketingConsent {
    if (row === undefined) return { state: "none", source: null, at: null, expiresAt: null };
    const base = { source: row.source, at: row.created_at, expiresAt: row.expires_at };
    if (row.status === "withdrawn") return { state: "opted_out", ...base };
    if (row.status === "implied")
        return row.expires_at !== null && parseTimestamp(row.expires_at) <= now
            ? { state: "none", ...base }
            : { state: "implied", ...base };
    return { state: "express", ...base };
}

const canBroadcast = (c: MarketingConsent): boolean =>
    c.state === "express" || c.state === "implied";

type ConsentMap = Map<string, MarketingConsent>;

/** Every client's current SMS consent. */
export function useConsents(): { map: ConsentMap; isLoading: boolean } {
    const rows = useQuery<ConsentRow>(LATEST_CONSENTS_SQL);
    const stopped = useQuery<{ client_id: string; created_at: string }>(TEXTS_STOPPED_SQL);
    const map = useMemo(() => {
        const now = new Date();
        const out: ConsentMap = new Map();
        for (const row of rows.data) {
            out.set(row.client_id, consentOf(row, now));
        }
        for (const stop of stopped.data) {
            out.set(stop.client_id, {
                state: "opted_out",
                source: "reply",
                at: stop.created_at,
                expiresAt: null,
            });
        }
        return out;
    }, [rows.data, stopped.data]);
    return { map, isLoading: rows.isLoading || stopped.isLoading };
}

export function consentFor(map: ConsentMap, clientId: string): MarketingConsent {
    return map.get(clientId) ?? consentOf(undefined);
}

function parseList(raw: string | null): string[] {
    if (raw === null || raw === "") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((t): t is string => typeof t === "string")
            : [];
    } catch {
        return [];
    }
}

function audienceTags(raw: string | null): string[] {
    if (raw === null) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || !("tags" in parsed)) return [];
        const tags = parsed.tags;
        return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
    } catch {
        return [];
    }
}

const GSM_BASIC = new Set(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

/** A GSM-7 SMS holds 160 septets (153 per part once split); UCS-2 holds 70 units (67 per part). */
export function smsSegments(body: string): { chars: number; segments: number } {
    const chars = body.length;
    if (chars === 0) return { chars, segments: 0 };
    let septets = 0;
    for (const c of body) {
        if (GSM_BASIC.has(c)) septets += 1;
        else if (GSM_EXTENDED.has(c)) septets += 2;
        else {
            return { chars, segments: chars <= 70 ? 1 : Math.ceil(chars / 67) };
        }
    }
    return { chars, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
}

interface AudienceExclusion {
    id: string;
    name: string;
    reason: "opted_out" | "no_consent" | "no_contact";
    detail: string;
}

interface BroadcastAudience {
    allTags: { tag: string; count: number }[];
    matched: number;
    recipients: { id: string; name: string }[];
    excluded: AudienceExclusion[];
}

function buildAudience(
    clients: AudienceClient[],
    consents: ConsentMap,
    tags: readonly string[],
    zone: string,
): BroadcastAudience {
    const counts = new Map<string, number>();
    const tagged = clients.map((c) => ({ ...c, list: parseList(c.tags) }));
    for (const c of tagged) for (const t of c.list) counts.set(t, (counts.get(t) ?? 0) + 1);
    const matched = tagged.filter((c) => tags.length === 0 || c.list.some((t) => tags.includes(t)));
    const recipients: BroadcastAudience["recipients"] = [];
    const excluded: AudienceExclusion[] = [];
    for (const c of matched) {
        const consent = consentFor(consents, c.id);
        if (c.phone === null || c.phone === "")
            excluded.push({ id: c.id, name: c.name, reason: "no_contact", detail: "" });
        else if (consent.state === "opted_out")
            excluded.push({
                id: c.id,
                name: c.name,
                reason: "opted_out",
                detail: b.consentSource(
                    b.sources[consent.source ?? ""] ?? "",
                    consent.at === null ? "" : formatDate(parseTimestamp(consent.at), zone),
                ),
            });
        else if (!canBroadcast(consent))
            excluded.push({ id: c.id, name: c.name, reason: "no_consent", detail: "" });
        else recipients.push({ id: c.id, name: c.name });
    }
    return {
        allTags: [...counts.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((x, y) => y.count - x.count),
        matched: matched.length,
        recipients,
        excluded,
    };
}

export interface BroadcastSeed {
    name: string;
    body: string;
    tags: string[];
}

export interface BroadcastDraft {
    load: Load;
    name: string;
    setName: (v: string) => void;
    body: string;
    setBody: (v: string) => void;
    tags: string[];
    toggleTag: (t: string) => void;
    clearTags: () => void;
    schedule: "now" | "later";
    setSchedule: (v: "now" | "later") => void;
    sendAt: string;
    setSendAt: (v: string) => void;
    audience: BroadcastAudience;
    business: string;
    // What the client receives, with the opt-out line the server adds.
    preview: string;
    segments: { chars: number; segments: number };
    busy: boolean;
    error: string | null;
    sent: BroadcastSent | null;
    reset: () => void;
    submit: () => void;
}

/** What the confirmation says: sent, scheduled, or held until quiet hours end. */
interface BroadcastSent {
    scheduled: boolean;
    title: string;
    body: string;
}

interface BroadcastResult {
    status: string;
    scheduled_at: string | null;
}

function sentNote(
    result: BroadcastResult,
    count: number,
    asked: "now" | "later",
    zone: string,
): BroadcastSent {
    if (result.status !== "scheduled" || result.scheduled_at === null)
        return { scheduled: false, title: b.sentTitle, body: b.sentBody(count) };
    if (asked === "now")
        return {
            scheduled: true,
            title: b.queuedTitle,
            body: b.queuedBody(formatDateTime(parseTimestamp(result.scheduled_at), zone), count),
        };
    return { scheduled: true, title: b.scheduledTitle, body: b.sentBody(count) };
}

/** The count is a preview; the server applies the same consent rules again at send time. */
export function useBroadcastDraft(api: ApiLike, seed?: BroadcastSeed): BroadcastDraft {
    const clients = useQuery<AudienceClient>(AUDIENCE_CLIENTS_SQL);
    const consents = useConsents();
    const business = useBusinessName();
    const [name, setName] = useState(seed?.name ?? "");
    const [body, setBody] = useState(seed?.body ?? "");
    const [tags, setTags] = useState<string[]>(seed?.tags ?? []);
    const [schedule, setSchedule] = useState<"now" | "later">("now");
    const [sendAt, setSendAt] = useState("");
    const [sent, setSent] = useState<BroadcastSent | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const zone = useBusinessZone();
    const audience = useMemo(
        () => buildAudience(clients.data, consents.map, tags, zone),
        [clients.data, consents.map, tags, zone],
    );
    const load = useReplicaLoad(
        [clients, { isLoading: consents.isLoading }],
        clients.data.length === 0,
    );
    const text = body.trim() || "…";
    const preview = b.smsPreview(business, text, b.optOutSms);

    const submit = (): void => {
        if (name.trim() === "") {
            setError(b.errors.nameRequired);
            return;
        }
        if (body.trim() === "") {
            setError(b.errors.bodyRequired);
            return;
        }
        if (audience.recipients.length === 0) {
            setError(b.errors.noRecipients);
            return;
        }
        const at = schedule === "later" && sendAt !== "" ? parseWallDateTime(sendAt, zone) : null;
        if (schedule === "later" && (at === null || at.getTime() <= Date.now())) {
            setError(b.errors.pickTime);
            return;
        }
        const count = audience.recipients.length;
        run(
            async () => {
                const input = {
                    name: name.trim(),
                    body: body.trim(),
                    audience: tags.length > 0 ? { tags } : { all: true },
                    scheduled_at: at === null ? null : at.toISOString(),
                };
                const result = await api.post<BroadcastResult>("/v1/broadcasts", input, {
                    idempotencyKey: attemptKey(attempt, input),
                });
                attempt.current = null;
                setSent(sentNote(result, count, schedule, zone));
            },
            { errorMessage: (e) => failureMessage(e, b.errors.sendError) },
        );
    };

    return {
        load,
        name,
        setName,
        body,
        setBody,
        tags,
        toggleTag: (t) => {
            setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
        },
        clearTags: () => {
            setTags([]);
        },
        schedule,
        setSchedule,
        sendAt,
        setSendAt,
        audience,
        business,
        preview,
        segments: smsSegments(preview),
        busy,
        error,
        sent,
        reset: () => {
            setSent(null);
            setName("");
            setBody("");
            setTags([]);
        },
        submit,
    };
}

export interface BroadcastItem extends BroadcastRow {
    tags: string[];
    at: string | null;
}

export function broadcastAudience(item: BroadcastItem): string {
    return item.tags.length === 0 ? b.everyone : formatList(item.tags, "unit");
}

export function broadcastWhen(item: BroadcastItem, zone: string): string {
    return item.at === null ? b.notSent : formatDateTime(parseTimestamp(item.at), zone);
}

export function broadcastIntent(status: string): Intent {
    return status === "sent"
        ? "success"
        : status === "scheduled"
          ? "accent"
          : status === "canceled"
            ? "neutral"
            : "warning";
}

interface ConsentLogRow {
    clientId: string;
    name: string;
    source: string;
    at: string;
}

export interface BroadcastsHome {
    load: Load;
    broadcasts: BroadcastItem[];
    reach: { sms: number; optedOut: number; total: number };
    optOuts: ConsentLogRow[];
    implied: (ConsentLogRow & { expires: string })[];
}

export function useBroadcastsHome(): BroadcastsHome {
    const rows = useQuery<BroadcastRow>(BROADCASTS_SQL);
    const clients = useQuery<AudienceClient>(AUDIENCE_CLIENTS_SQL);
    const consents = useConsents();
    const load = useReplicaLoad([rows, clients, { isLoading: consents.isLoading }], false);
    const home = useMemo(() => {
        let sms = 0;
        const out = new Set<string>();
        const optOuts: ConsentLogRow[] = [];
        const implied: (ConsentLogRow & { expires: string })[] = [];
        for (const c of clients.data) {
            const k = consentFor(consents.map, c.id);
            if (canBroadcast(k) && c.phone !== null && c.phone !== "") sms++;
            if (k.state === "opted_out") {
                out.add(c.id);
                optOuts.push({
                    clientId: c.id,
                    name: c.name,
                    source: b.sources[k.source ?? ""] ?? "",
                    at: k.at ?? "",
                });
            }
            if (k.state === "implied" && k.expiresAt !== null)
                implied.push({
                    clientId: c.id,
                    name: c.name,
                    source: b.sources[k.source ?? ""] ?? "",
                    at: k.at ?? "",
                    expires: k.expiresAt,
                });
        }
        optOuts.sort((x, y) => y.at.localeCompare(x.at));
        implied.sort((x, y) => x.expires.localeCompare(y.expires));
        return {
            broadcasts: rows.data.map((row) => ({
                ...row,
                tags: audienceTags(row.audience),
                at:
                    row.status === "scheduled" || row.status === "canceled"
                        ? row.scheduled_at
                        : row.status === "sent" || row.status === "sending"
                          ? row.created_at
                          : null,
            })),
            reach: { sms, optedOut: out.size, total: clients.data.length },
            optOuts,
            implied,
        };
    }, [rows.data, clients.data, consents.map]);
    return { load, ...home };
}

interface BroadcastActions {
    busy: boolean;
    error: string | null;
    exported: string | null;
    exportLog: () => void;
    cancel: (id: string) => void;
}

/** `save` hands the CSV to the platform: a download on web, the share sheet on a phone. */
export function useBroadcastActions(
    api: ApiLike,
    save: (filename: string, content: string) => void,
): BroadcastActions {
    const [exported, setExported] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    return {
        busy,
        error,
        exported,
        exportLog: () => {
            run(
                async () => {
                    const out = await api.post<{ filename: string; content: string }>(
                        "/v1/consents/export",
                        {},
                    );
                    save(out.filename, out.content);
                    setExported(out.filename);
                },
                { errorMessage: b.actionErrors.exportFailed },
            );
        },
        cancel: (id) => {
            run(() => api.post(`/v1/broadcasts/${id}/cancel`, {}), {
                errorMessage: b.actionErrors.cancelFailed,
            });
        },
    };
}
