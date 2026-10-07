import { useQuery } from "@powersync/react";
import { useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { formatDate, formatMonthYear, formatTime, parseTimestamp, relativeDay } from "../datetime";
import { blankToNull, formatMoney, formatPhone, phoneDigits } from "../format";
import { useAsyncAction } from "../hooks";
import type { Load } from "../hooks";
import type { IconName } from "../icons";
import { strings } from "../strings";
import type { Intent, TimelineEntry } from "../ui";
import { utcSql } from "./bookings";
import { clientValueSql, invoiceStatusSql } from "./ledger";
import {
    type SavedCardRow,
    canBeDefault,
    detachCard,
    isMandate,
    mandateStatusIntent,
    savedCardLabel,
    setDefaultCard,
} from "./payments";
import { useReplicaLoad } from "./sync";

const s = strings.clients;

// Active clients for pickers (booking, sale, invoice, message): archived ones are left out.
export interface ClientRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
    lifetime_value_cents: number | null;
}

export const CLIENTS_SQL = `
SELECT c.id, c.name, c.email, c.phone, c.status, ${clientValueSql("c.id")} AS lifetime_value_cents
FROM clients c WHERE c.status = 'active' ORDER BY c.name COLLATE NOCASE`;

export function useClients(): ClientRow[] {
    return useQuery<ClientRow>(CLIENTS_SQL).data;
}

export function filterClients(rows: ClientRow[], q: string): ClientRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
        (c) =>
            c.name.toLowerCase().includes(t) ||
            (c.email ?? "").toLowerCase().includes(t) ||
            (c.phone ?? "").includes(t),
    );
}

export function createClient(
    api: ApiLike,
    input: { name: string; email?: string | null; phone?: string | null },
): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/clients", {
        name: input.name.trim(),
        email: blankToNull(input.email),
        phone: blankToNull(input.phone),
    });
}

/** A Postgres text[] synced as JSON text; an unreadable value reads as no tags. */
function parseTags(raw: string | null): string[] {
    if (raw === null || raw === "") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((t): t is string => typeof t === "string")
            : [];
    } catch {
        return raw
            .replace(/^\{|\}$/g, "")
            .split(",")
            .map((t) => t.replace(/^"|"$/g, "").trim())
            .filter((t) => t !== "");
    }
}

function parseObject(raw: string | null): Record<string, unknown> {
    if (raw === null || raw === "") return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

const fold = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const nextVisitSql = (clientExpr: string): string => `(SELECT s.starts_at FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.client_id = ${clientExpr} AND b.deleted_at IS NULL AND b.status IN ('pending', 'confirmed')
      AND ${utcSql("s.ends_at")} > datetime('now')
    ORDER BY ${utcSql("s.starts_at")} LIMIT 1)`;

const DIRECTORY_SELECT = `
SELECT c.id, c.name, c.email, c.phone, c.status, c.tags, c.preferred_channel, c.archived_at,
       c.created_at, ${clientValueSql("c.id")} AS lifetime_value_cents,
       (SELECT group_concat(sj.name, ', ') FROM subjects sj
          WHERE sj.client_id = c.id AND sj.deleted_at IS NULL) AS pet_names,
       ${nextVisitSql("c.id")} AS next_visit_at,
       (SELECT SUM(a.balance_cents) FROM accounts a WHERE a.owner_type = 'client'
          AND a.owner_id = c.id AND a.category = 'receivable') AS balance_cents
FROM clients c`;

export const CLIENT_DIRECTORY_SQL = `${DIRECTORY_SELECT} ORDER BY c.name COLLATE NOCASE`;

export const CLIENT_SQL = `${DIRECTORY_SELECT} WHERE c.id = ?`;

interface DirectoryRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
    tags: string | null;
    preferred_channel: string | null;
    archived_at: string | null;
    created_at: string;
    lifetime_value_cents: number | null;
    pet_names: string | null;
    next_visit_at: string | null;
    balance_cents: number | null;
}

export interface ClientListRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    phoneLabel: string;
    archived: boolean;
    archivedAt: Date | null;
    tags: string[];
    channel: ContactChannel;
    pets: string;
    next: Date | null;
    balanceCents: number;
    lifetimeCents: number | null;
    since: Date;
}

type ContactChannel = "sms" | "email";

function toListRow(r: DirectoryRow): ClientListRow {
    return {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        phoneLabel: formatPhone(r.phone),
        archived: r.status !== "active",
        archivedAt: r.archived_at === null ? null : parseTimestamp(r.archived_at),
        tags: parseTags(r.tags),
        channel: r.preferred_channel === "email" ? "email" : "sms",
        pets: r.pet_names ?? "",
        next: r.next_visit_at === null ? null : parseTimestamp(r.next_visit_at),
        balanceCents: r.balance_cents ?? 0,
        lifetimeCents: r.lifetime_value_cents,
        since: parseTimestamp(r.created_at),
    };
}

/** Search by name, any phone format, email or pet name. */
function matchesClient(row: ClientListRow, q: string): boolean {
    const t = fold(q);
    if (t === "") return true;
    const digits = phoneDigits(q);
    return (
        fold(row.name).includes(t) ||
        (row.email ?? "").toLowerCase().includes(t) ||
        (digits.length >= 3 && phoneDigits(row.phone).includes(digits)) ||
        fold(row.pets).includes(t) ||
        row.tags.some((tag) => tag.includes(t))
    );
}

export type ClientSegment = "active" | "archived";

interface ClientDirectory {
    load: Load;
    all: ClientListRow[];
    rows: ClientListRow[];
    segment: ClientSegment;
    setSegment: (s: ClientSegment) => void;
    q: string;
    setQ: (q: string) => void;
    counts: Record<ClientSegment, number>;
}

/** The client list: Active and Archived, searched by name, phone, email, pet or tag. */
export function useClientDirectory(): ClientDirectory {
    const query = useQuery<DirectoryRow>(CLIENT_DIRECTORY_SQL);
    const all = useMemo(() => query.data.map(toListRow), [query.data]);
    const load = useReplicaLoad([query], all.length === 0);
    const [segment, setSegment] = useState<ClientSegment>("active");
    const [q, setQ] = useState("");
    const rows = useMemo(
        () => all.filter((c) => (segment === "archived") === c.archived && matchesClient(c, q)),
        [all, segment, q],
    );
    const counts = {
        active: all.filter((c) => !c.archived).length,
        archived: all.filter((c) => c.archived).length,
    };
    return { load, all, rows, segment, setSegment, q, setQ, counts };
}

interface TagCount {
    tag: string;
    count: number;
}

/** Every tag in use, most used first, so the same tag isn't spelled three ways. */
function tagDirectory(rows: readonly ClientListRow[]): TagCount[] {
    const map = new Map<string, number>();
    for (const row of rows) for (const t of row.tags) map.set(t, (map.get(t) ?? 0) + 1);
    return [...map.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

const cleanTag = (t: string): string => t.trim().toLowerCase().replace(/\s+/g, " ");

export const CLIENT_VISITS_SQL = `
SELECT b.id, b.status, b.subject_id, b.staff_id, b.deposit_amount_cents, b.deposit_status,
       s.starts_at, s.ends_at, i.name AS item_name, i.color AS item_color, st.name AS staff_name
FROM bookings b
JOIN slots s ON s.id = b.slot_id
LEFT JOIN items i ON i.id = s.item_id
LEFT JOIN staff st ON st.id = b.staff_id
WHERE b.client_id = ? AND b.deleted_at IS NULL
ORDER BY ${utcSql("s.starts_at")} DESC`;

interface VisitRow {
    id: string;
    status: string;
    subject_id: string | null;
    staff_id: string | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
    starts_at: string;
    ends_at: string;
    item_name: string | null;
    item_color: string | null;
    staff_name: string | null;
}

interface ClientVisit {
    id: string;
    status: string;
    subjectId: string | null;
    start: Date;
    end: Date;
    service: string;
    color: string | null;
    staffName: string | null;
    depositCents: number;
    depositStatus: string;
}

function toVisit(r: VisitRow): ClientVisit {
    return {
        id: r.id,
        status: r.status,
        subjectId: r.subject_id,
        start: parseTimestamp(r.starts_at),
        end: parseTimestamp(r.ends_at),
        service: r.item_name ?? "",
        color: r.item_color,
        staffName: r.staff_name,
        depositCents: r.deposit_amount_cents ?? 0,
        depositStatus: r.deposit_status ?? "none",
    };
}

// Booked and not finished yet, so a visit under way still counts as coming up.
function isAhead(v: ClientVisit, now: Date = new Date()): boolean {
    return v.end > now && (v.status === "confirmed" || v.status === "pending");
}

/** In progress for a visit under way, else the deposit state when the service takes one. */
export function visitPill(
    v: ClientVisit,
    now: Date = new Date(),
): { label: string; intent: Intent } | null {
    if (v.start <= now) return { label: s.record.inProgress, intent: "accent" };
    if (v.depositCents <= 0) return null;
    const paid = v.depositStatus === "collected" || v.depositStatus === "applied";
    const amount = formatMoney(v.depositCents);
    return paid
        ? { label: s.record.depositPaid(amount), intent: "success" }
        : { label: s.record.depositDue(amount), intent: "warning" };
}

export const CLIENT_SUBJECTS_SQL = `
SELECT id, client_id, kind, name, attributes, created_at FROM subjects
WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at, name`;

interface SubjectDbRow {
    id: string;
    client_id: string;
    kind: string;
    name: string;
    attributes: string | null;
    created_at: string;
}

export interface SubjectRow {
    id: string;
    clientId: string;
    kind: string;
    name: string;
    attributes: Record<string, unknown>;
}

function toSubject(r: SubjectDbRow): SubjectRow {
    return {
        id: r.id,
        clientId: r.client_id,
        kind: r.kind,
        name: r.name,
        attributes: parseObject(r.attributes),
    };
}

const text = (v: unknown): string =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

export function petSummary(pet: SubjectRow): string {
    const weight = Number(text(pet.attributes.weight_kg));
    return [text(pet.attributes.breed), weight > 0 ? s.pets.weight(weight) : ""]
        .filter((x) => x !== "")
        .join(" · ");
}

export const CLIENT_NOTES_SQL = `
SELECT n.id, n.parent_type, n.parent_id, n.body, n.pinned, n.created_by, n.created_at,
       st.id AS author_staff_id, st.name AS author_name, sj.name AS subject_name
FROM notes n
LEFT JOIN subjects sj ON n.parent_type = 'subject' AND sj.id = n.parent_id
LEFT JOIN staff st ON st.user_id = n.created_by
WHERE (n.parent_type = 'client' AND n.parent_id = ?)
   OR (n.parent_type = 'subject' AND sj.client_id = ?)
ORDER BY n.pinned DESC, n.created_at DESC`;

interface NoteDbRow {
    id: string;
    parent_type: string;
    parent_id: string;
    body: string;
    pinned: number | null;
    created_by: string | null;
    created_at: string;
    author_staff_id: string | null;
    author_name: string | null;
    subject_name: string | null;
}

export interface ClientNote {
    id: string;
    body: string;
    pinned: boolean;
    at: Date;
    author: string;
    pet: string | null;
    subjectId: string | null;
    mine: boolean;
}

function toNote(r: NoteDbRow, viewerStaffId: string | null): ClientNote {
    const mine = viewerStaffId !== null && r.author_staff_id === viewerStaffId;
    return {
        id: r.id,
        body: r.body,
        pinned: r.pinned === 1,
        at: parseTimestamp(r.created_at),
        author: mine ? s.history.you : (r.author_name ?? s.history.teammate),
        pet: r.subject_name,
        subjectId: r.parent_type === "subject" ? r.parent_id : null,
        mine,
    };
}

export const CLIENT_METHODS_SQL = `
SELECT pm.id, pm.client_id, pm.method, pm.brand, pm.last4, pm.preferred, pm.mandate_status,
       pm.status, pm.exp_month, pm.exp_year, pm.holder_name, pm.bank_name, pm.created_at,
       (SELECT group_concat(i.name, ', ') FROM subscriptions sb LEFT JOIN items i ON i.id = sb.item_id
          WHERE sb.payment_method_id = pm.id AND sb.status IN ('active', 'past_due', 'paused')) AS pays
FROM payment_methods pm
WHERE pm.client_id = ? AND pm.status = 'active'
ORDER BY pm.preferred DESC, pm.created_at`;

interface MethodDbRow extends SavedCardRow {
    exp_month: number | null;
    exp_year: number | null;
    holder_name: string | null;
    bank_name: string | null;
    created_at: string;
    pays: string | null;
}

export const CLIENT_PLANS_SQL = `
SELECT 'package' AS kind, p.id, i.name AS item_name, p.status, p.sessions_total,
       (SELECT COUNT(DISTINCT le.journal_id) FROM entries le WHERE le.event = 'consumption'
          AND le.subject_type = 'package' AND le.subject_id = p.id) AS sessions_used,
       NULL AS renews_at
FROM packages p LEFT JOIN items i ON i.id = p.item_id
WHERE p.client_id = ? AND p.status IN ('active', 'pending')
UNION ALL
SELECT 'subscription' AS kind, sb.id, i.name AS item_name, sb.status, NULL, NULL,
       sb.current_period_end AS renews_at
FROM subscriptions sb LEFT JOIN items i ON i.id = sb.item_id
WHERE sb.client_id = ? AND sb.status IN ('active', 'past_due', 'paused')`;

interface PlanDbRow {
    kind: "package" | "subscription";
    id: string;
    item_name: string | null;
    status: string;
    sessions_total: number | null;
    sessions_used: number | null;
    renews_at: string | null;
}

interface ClientPlan {
    id: string;
    name: string;
    detail: string;
}

function toPlan(r: PlanDbRow): ClientPlan {
    const name = r.item_name ?? (r.kind === "package" ? s.packageFallback : s.subscriptionFallback);
    if (r.kind === "package") {
        const total = r.sessions_total ?? 0;
        return {
            id: r.id,
            name,
            detail: s.sessionsLeftShort(Math.max(0, total - (r.sessions_used ?? 0)), total),
        };
    }
    return {
        id: r.id,
        name,
        detail:
            r.renews_at === null ? "" : s.record.renews(formatDate(parseTimestamp(r.renews_at))),
    };
}

export interface ClientRecord {
    client: ClientListRow;
    pets: SubjectRow[];
    notes: ClientNote[];
    upcoming: ClientVisit[];
    lastVisit: ClientVisit | null;
    visits: number;
    methods: SavedCardRow[];
    plans: ClientPlan[];
}

/** One client's record: facts, pets, what is booked, notes and how they pay. */
export function useClientRecord(
    clientId: string | null,
    viewerStaffId: string | null = null,
): { load: Load; record: ClientRecord | null } {
    const id = clientId ?? "";
    const client = useQuery<DirectoryRow>(CLIENT_SQL, [id]);
    const visits = useQuery<VisitRow>(CLIENT_VISITS_SQL, [id]);
    const subjects = useQuery<SubjectDbRow>(CLIENT_SUBJECTS_SQL, [id]);
    const notes = useQuery<NoteDbRow>(CLIENT_NOTES_SQL, [id, id]);
    const methods = useQuery<SavedCardRow>(CLIENT_METHODS_SQL, [id]);
    const plans = useQuery<PlanDbRow>(CLIENT_PLANS_SQL, [id, id]);
    const row = client.data[0];
    const load = useReplicaLoad([client, visits, subjects, notes], row === undefined);
    const record = useMemo(() => {
        if (row === undefined) return null;
        const now = new Date();
        const all = visits.data.map(toVisit);
        const done = all.filter((v) => v.status === "completed");
        return {
            client: toListRow(row),
            pets: subjects.data.map(toSubject),
            notes: notes.data.map((n) => toNote(n, viewerStaffId)),
            upcoming: all.filter((v) => isAhead(v, now)).reverse(),
            lastVisit: done[0] ?? null,
            visits: done.length,
            methods: methods.data,
            plans: plans.data.map(toPlan),
        };
    }, [row, visits.data, subjects.data, notes.data, methods.data, plans.data, viewerStaffId]);
    return { load, record };
}

export interface DuplicateMatch {
    client: ClientListRow;
    reasons: string[];
}

/** Existing clients that share a phone, an email or the exact name with what is being typed. */
function findDuplicates(
    draft: { name: string; phone: string; email: string },
    rows: readonly ClientListRow[],
    exceptId: string | null,
): DuplicateMatch[] {
    const phone = phoneDigits(draft.phone);
    const email = draft.email.trim().toLowerCase();
    const name = fold(draft.name);
    return rows
        .filter((c) => c.id !== exceptId)
        .map((c) => {
            const reasons: string[] = [];
            if (phone.length === 10 && phoneDigits(c.phone) === phone)
                reasons.push(s.edit.reasonPhone);
            if (email.includes("@") && (c.email ?? "").toLowerCase() === email)
                reasons.push(s.edit.reasonEmail);
            if (name.length > 3 && fold(c.name) === name) reasons.push(s.edit.reasonName);
            return { client: c, reasons };
        })
        .filter((m) => m.reasons.length > 0);
}

interface ClientDraft {
    name: string;
    phone: string;
    email: string;
    channel: ContactChannel;
    tags: string[];
    consent: boolean;
    petName: string;
    petBreed: string;
}

type DraftErrors = Partial<Record<"name" | "phone" | "email" | "contact", string>>;

function validateDraft(d: ClientDraft): DraftErrors {
    const e: DraftErrors = {};
    if (d.name.trim() === "") e.name = s.edit.nameRequired;
    if (d.phone.trim() !== "" && phoneDigits(d.phone).length !== 10) e.phone = s.edit.phoneInvalid;
    if (d.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
        e.email = s.edit.emailInvalid;
    if (d.phone.trim() === "" && d.email.trim() === "") e.contact = s.edit.contactRequired;
    return e;
}

export const CLIENT_CONSENT_SQL = `
SELECT cn.status, cn.created_at, st.name AS recorded_by_name
FROM consents cn LEFT JOIN staff st ON st.user_id = cn.recorded_by
WHERE cn.client_id = ? AND cn.channel = 'sms'
ORDER BY cn.created_at DESC LIMIT 1`;

export interface ClientEditor {
    mode: "add" | "edit";
    client: ClientListRow | null;
    draft: ClientDraft;
    set: <K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) => void;
    errors: DraftErrors;
    duplicates: DuplicateMatch[];
    ignoreDuplicates: () => void;
    dirty: boolean;
    consentNote: string | null;
    archivedNote: string | null;
    busy: boolean;
    error: string | null;
    submit: () => void;
    archive: () => void;
    restore: () => void;
    tagSuggestions: TagCount[];
}

function draftFor(client: ClientListRow | null, consent: boolean): ClientDraft {
    return {
        name: client?.name ?? "",
        phone: client === null ? "" : formatPhone(client.phone),
        email: client?.email ?? "",
        channel: client?.channel ?? "sms",
        tags: client?.tags ?? [],
        consent,
        petName: "",
        petBreed: "",
    };
}

/** Add when `clientId` is null, edit otherwise. Errors show after the first submit. */
export function useClientEditor(
    api: ApiLike,
    directory: readonly ClientListRow[],
    clientId: string | null,
    onSaved: (id: string) => void,
): ClientEditor {
    const client = directory.find((c) => c.id === clientId) ?? null;
    const consentRow = useQuery<{
        status: string;
        created_at: string;
        recorded_by_name: string | null;
    }>(CLIENT_CONSENT_SQL, [clientId ?? ""]).data[0];
    const agreed = consentRow !== undefined && consentRow.status !== "withdrawn";
    const initial = useMemo(() => draftFor(client, agreed), [client, agreed]);
    const [draft, setDraft] = useState<ClientDraft>(initial);
    const [tried, setTried] = useState(false);
    const [ignored, setIgnored] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    const set = <K extends keyof ClientDraft>(key: K, value: ClientDraft[K]): void => {
        setDraft((d) => ({ ...d, [key]: value }));
        setError(null);
    };
    const contactChanged =
        client === null ||
        draft.name !== initial.name ||
        draft.phone !== initial.phone ||
        draft.email !== initial.email;
    const duplicates = ignored || !contactChanged ? [] : findDuplicates(draft, directory, clientId);
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

    const submit = (): void => {
        setTried(true);
        if (Object.keys(validateDraft(draft)).length > 0) return;
        const body = {
            name: draft.name.trim(),
            phone: phoneDigits(draft.phone) || null,
            email: blankToNull(draft.email),
            preferred_channel: draft.channel,
            tags: draft.tags,
        };
        const petName = draft.petName.trim();
        run(
            async () => {
                if (client === null) {
                    const saved = await api.post<{ id: string }>("/v1/clients", {
                        ...body,
                        marketing_consent: draft.consent,
                        subject:
                            petName === ""
                                ? null
                                : {
                                      kind: "pet",
                                      name: petName,
                                      attributes: { breed: blankToNull(draft.petBreed) },
                                  },
                    });
                    onSaved(saved.id);
                    return;
                }
                await api.patch(`/v1/clients/${client.id}`, {
                    ...body,
                    ...(draft.consent === initial.consent
                        ? {}
                        : { marketing_consent: draft.consent }),
                });
                onSaved(client.id);
            },
            { errorMessage: s.edit.saveError },
        );
    };

    const lifecycle = (path: "archive" | "restore", message: string): void => {
        if (client === null) return;
        const key = newIdempotencyKey();
        run(() => api.post(`/v1/clients/${client.id}/${path}`, {}, { idempotencyKey: key }), {
            errorMessage: message,
        });
    };

    const tags = tagDirectory(directory);
    return {
        mode: client === null ? "add" : "edit",
        client,
        draft,
        set,
        errors: tried ? validateDraft(draft) : {},
        duplicates,
        ignoreDuplicates: () => {
            setIgnored(true);
        },
        dirty,
        consentNote:
            consentRow !== undefined && agreed
                ? s.edit.consentRecorded(
                      formatDate(parseTimestamp(consentRow.created_at)),
                      consentRow.recorded_by_name ?? s.history.teammate,
                  )
                : null,
        archivedNote:
            client?.archived === true
                ? client.archivedAt === null
                    ? s.edit.archivedNoDate
                    : s.edit.archivedBanner(formatDate(client.archivedAt))
                : null,
        busy,
        error,
        submit,
        archive: () => {
            lifecycle("archive", s.edit.archiveError);
        },
        restore: () => {
            lifecycle("restore", s.edit.restoreError);
        },
        tagSuggestions: tags.filter((t) => !draft.tags.includes(t.tag)),
    };
}

type SubjectFieldType = "text" | "number" | "date" | "choice" | "longtext";

interface SubjectField {
    key: string;
    label: string;
    type: SubjectFieldType;
    options?: readonly { key: string; label: string }[] | undefined;
    unit?: string | undefined;
    placeholder?: string | undefined;
    half?: boolean | undefined;
}

// One schema per subject kind; the form and the card render from it, so other kinds need no new screens.
const PET_FIELDS: readonly SubjectField[] = [
    {
        key: "species",
        label: s.pets.speciesLabel,
        type: "choice",
        options: [
            { key: "dog", label: s.pets.dog },
            { key: "cat", label: s.pets.cat },
            { key: "other", label: s.pets.other },
        ],
    },
    { key: "breed", label: s.pets.breedLabel, type: "text", half: true },
    {
        key: "weight_kg",
        label: s.pets.weightLabel,
        type: "number",
        unit: s.pets.weightUnit,
        half: true,
    },
    { key: "birthday", label: s.pets.birthdayLabel, type: "date", half: true },
    {
        key: "sex",
        label: s.pets.sexLabel,
        type: "choice",
        options: [
            { key: "female", label: s.pets.female },
            { key: "male", label: s.pets.male },
        ],
        half: true,
    },
    {
        key: "temperament",
        label: s.pets.temperamentLabel,
        type: "choice",
        options: s.pets.temperaments.map((t) => ({ key: t, label: t })),
    },
    { key: "coat", label: s.pets.coatLabel, type: "text", half: true },
    {
        key: "allergies",
        label: s.pets.allergiesLabel,
        type: "text",
        placeholder: s.pets.allergiesPlaceholder,
        half: true,
    },
    { key: "vet", label: s.pets.vetLabel, type: "text", half: true },
    { key: "rabies_until", label: s.pets.rabiesLabel, type: "date", half: true },
    {
        key: "style",
        label: s.pets.styleLabel,
        type: "longtext",
        placeholder: s.pets.stylePlaceholder,
    },
];

// A date-only value is a local calendar day, not UTC midnight.
const dayOf = (v: string): Date => new Date(v.length === 10 ? `${v}T12:00:00` : v);

function ageYears(birthday: string, now: Date): number | null {
    const b = dayOf(birthday);
    if (Number.isNaN(b.getTime())) return null;
    let years = now.getFullYear() - b.getFullYear();
    if (
        now.getMonth() < b.getMonth() ||
        (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())
    )
        years -= 1;
    return years;
}

interface PetAlert {
    key: string;
    label: string;
    intent: Intent;
}

function petAlerts(pet: SubjectRow, now: Date = new Date()): PetAlert[] {
    const out: PetAlert[] = [];
    const temperament = text(pet.attributes.temperament);
    if (temperament === "anxious" || temperament === "reactive")
        out.push({ key: "temp", label: s.pets.temperamentAlert(temperament), intent: "warning" });
    const allergies = text(pet.attributes.allergies);
    if (allergies !== "")
        out.push({ key: "allergy", label: s.pets.allergy(allergies), intent: "danger" });
    const rabies = text(pet.attributes.rabies_until);
    if (rabies !== "") {
        const days = (dayOf(rabies).getTime() - now.getTime()) / 86_400_000;
        if (days < 0) out.push({ key: "rabies", label: s.pets.rabiesExpired, intent: "danger" });
        else if (days < 45)
            out.push({
                key: "rabies",
                label: s.pets.rabiesSoon(formatDate(dayOf(rabies))),
                intent: "warning",
            });
    }
    return out;
}

export interface PetCard {
    pet: SubjectRow;
    line: string;
    temperament: string | null;
    alerts: PetAlert[];
    visits: number;
    lastVisit: Date | null;
    next: Date | null;
}

/** A pet's card: who they are, what to watch for and their visits (bookings name the pet). */
function petCard(pet: SubjectRow, visits: readonly ClientVisit[], now: Date = new Date()): PetCard {
    const own = visits.filter((v) => v.subjectId === pet.id);
    const done = own.filter((v) => v.status === "completed");
    const ahead = own.filter((v) => isAhead(v, now)).sort((a, b) => +a.start - +b.start);
    const birthday = text(pet.attributes.birthday);
    const age = birthday === "" ? null : ageYears(birthday, now);
    const weight = Number(text(pet.attributes.weight_kg));
    const temperament = text(pet.attributes.temperament);
    return {
        pet,
        line: [
            text(pet.attributes.breed),
            age === null ? "" : s.pets.age(age),
            weight > 0 ? s.pets.weight(weight) : "",
        ]
            .filter((x) => x !== "")
            .join(" · "),
        temperament: temperament === "" ? null : temperament,
        alerts: petAlerts(pet, now),
        visits: done.length,
        lastVisit: done[0]?.start ?? null,
        next: ahead[0]?.start ?? null,
    };
}

export function useClientPets(clientId: string): { load: Load; cards: PetCard[] } {
    const subjects = useQuery<SubjectDbRow>(CLIENT_SUBJECTS_SQL, [clientId]);
    const visits = useQuery<VisitRow>(CLIENT_VISITS_SQL, [clientId]);
    const cards = useMemo(() => {
        const all = visits.data.map(toVisit);
        return subjects.data.map((r) => petCard(toSubject(r), all));
    }, [subjects.data, visits.data]);
    return { load: useReplicaLoad([subjects, visits], cards.length === 0), cards };
}

export interface SubjectForm {
    mode: "add" | "edit";
    fields: readonly SubjectField[];
    name: string;
    setName: (v: string) => void;
    values: Record<string, string>;
    setValue: (key: string, v: string) => void;
    errors: Record<string, string>;
    busy: boolean;
    error: string | null;
    submit: () => void;
    remove: () => void;
}

function valuesFor(pet: SubjectRow | null): Record<string, string> {
    if (pet === null) return { species: "dog" };
    return Object.fromEntries(PET_FIELDS.map((f) => [f.key, text(pet.attributes[f.key])]));
}

/** Add or edit one pet from the per-kind schema; unknown details already on the pet are kept. */
export function useSubjectForm(
    api: ApiLike,
    clientId: string,
    pet: SubjectRow | null,
    onDone: () => void,
): SubjectForm {
    const [name, setNameRaw] = useState(pet?.name ?? "");
    const [values, setValues] = useState<Record<string, string>>(() => valuesFor(pet));
    const [tried, setTried] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();

    const check = (): Record<string, string> => {
        const e: Record<string, string> = {};
        if (name.trim() === "") e.name = s.pets.nameRequired;
        const w = values.weight_kg ?? "";
        if (w !== "" && !(Number(w) > 0 && Number(w) < 200)) e.weight_kg = s.pets.weightInvalid;
        for (const key of ["birthday", "rabies_until"]) {
            const v = values[key] ?? "";
            if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) e[key] = s.pets.dateInvalid;
        }
        return e;
    };

    const submit = (): void => {
        setTried(true);
        if (Object.keys(check()).length > 0) return;
        const known = new Set(PET_FIELDS.map((f) => f.key));
        const kept = Object.fromEntries(
            Object.entries(pet?.attributes ?? {}).filter(([k]) => !known.has(k)),
        );
        const typed = Object.fromEntries(
            Object.entries(values)
                .filter(([, v]) => v.trim() !== "")
                .map(([k, v]) => [k, k === "weight_kg" ? Number(v) : v.trim()]),
        );
        const attributes = { ...kept, ...typed };
        run(
            async () => {
                if (pet === null) {
                    await api.post("/v1/subjects", {
                        client_id: clientId,
                        kind: "pet",
                        name: name.trim(),
                        attributes,
                    });
                } else {
                    await api.patch(`/v1/subjects/${pet.id}`, { name: name.trim(), attributes });
                }
                onDone();
            },
            { errorMessage: s.pets.saveError },
        );
    };

    return {
        mode: pet === null ? "add" : "edit",
        fields: PET_FIELDS,
        name,
        setName: (v) => {
            setNameRaw(v);
            setError(null);
        },
        values,
        setValue: (key, v) => {
            setValues((x) => ({ ...x, [key]: v }));
            setError(null);
        },
        errors: tried ? check() : {},
        busy,
        error,
        submit,
        remove: () => {
            if (pet === null) return;
            run(
                async () => {
                    await api.delete(`/v1/subjects/${pet.id}`);
                    onDone();
                },
                { errorMessage: s.pets.removeError },
            );
        },
    };
}

export const CLIENT_INVOICES_SQL = `
SELECT i.id, i.number, ${invoiceStatusSql("i")} AS status, i.total_cents,
       COALESCE(i.issued_at, i.created_at) AS at
FROM invoices i WHERE i.client_id = ?`;

export const CLIENT_PAYMENTS_SQL = `
SELECT p.id, p.kind, p.amount_cents, COALESCE(p.paid_at, p.created_at) AS at
FROM payments p WHERE p.client_id = ? AND p.status IN ('succeeded', 'refunded')`;

export const CLIENT_MESSAGES_SQL = `
SELECT m.id, m.direction, m.channel, m.body, m.created_at AS at
FROM messages m JOIN threads t ON t.id = m.thread_id
WHERE t.client_id = ? AND m.broadcast_id IS NULL`;

export const CLIENT_REVIEWS_SQL = `
SELECT r.id, r.rating, r.body, COALESCE(r.submitted_at, r.created_at) AS at
FROM reviews r WHERE r.client_id = ? AND r.rating IS NOT NULL`;

export type ClientHistoryFilter = "all" | "visits" | "money" | "messages" | "notes";

type HistoryKind =
    "visit" | "booked" | "invoice" | "payment" | "refund" | "message" | "review" | "note";

interface HistoryEntry {
    key: string;
    kind: HistoryKind;
    filter: Exclude<ClientHistoryFilter, "all">;
    at: Date;
    label: string;
    detail?: string | undefined;
    quote?: string | undefined;
    aside?: string | undefined;
    icon: IconName;
    intent: Intent;
}

const FILTER_OF: Record<HistoryKind, HistoryEntry["filter"]> = {
    visit: "visits",
    booked: "visits",
    invoice: "money",
    payment: "money",
    refund: "money",
    message: "messages",
    review: "messages",
    note: "notes",
};

const ICON_OF: Record<HistoryKind, IconName> = {
    visit: "paw",
    booked: "calendar",
    invoice: "invoices",
    payment: "dollar",
    refund: "refresh",
    message: "inbox",
    review: "star",
    note: "edit",
};

function entry(
    kind: HistoryKind,
    rest: Omit<HistoryEntry, "kind" | "filter" | "icon" | "intent"> & { intent?: Intent },
): HistoryEntry {
    return {
        kind,
        filter: FILTER_OF[kind],
        icon: ICON_OF[kind],
        intent: rest.intent ?? "neutral",
        ...rest,
    };
}

/** The shared timeline's row for one history entry; the month heading carries the year. */
export function toTimeline(e: HistoryEntry): TimelineEntry {
    return {
        key: e.key,
        label: e.label,
        detail: e.detail,
        at: `${e.at.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} · ${formatTime(e.at)}`,
        intent: e.intent,
        icon: e.icon,
        quote: e.quote,
        aside: e.aside,
    };
}

interface HistoryGroup {
    key: string;
    label: string;
    entries: HistoryEntry[];
}

export interface NoteComposer {
    body: string;
    setBody: (v: string) => void;
    pinned: boolean;
    setPinned: (v: boolean) => void;
    about: string;
    setAbout: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Note box: who or which pet it is about, and whether it is pinned to every booking. */
export function useNoteComposer(
    api: ApiLike,
    clientId: string,
    onSaved?: () => void,
    initialAbout = "client",
): NoteComposer {
    const [body, setBody] = useState("");
    const [pinned, setPinned] = useState(false);
    const [about, setAbout] = useState(initialAbout);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        body,
        setBody: (v) => {
            setBody(v);
            setError(null);
        },
        pinned,
        setPinned,
        about,
        setAbout,
        busy,
        error,
        submit: () => {
            if (body.trim() === "") {
                setError(s.history.noteRequired);
                return;
            }
            const subject = about !== "client";
            run(
                async () => {
                    await api.post("/v1/notes", {
                        parent_type: subject ? "subject" : "client",
                        parent_id: subject ? about : clientId,
                        body: body.trim(),
                        pinned,
                    });
                    setBody("");
                    setPinned(false);
                    onSaved?.();
                },
                { errorMessage: s.history.noteError },
            );
        },
    };
}

interface NoteActions {
    busyId: string | null;
    error: string | null;
    togglePin: (note: ClientNote) => void;
    edit: (note: ClientNote, body: string) => void;
    remove: (note: ClientNote) => void;
}

export function useNoteActions(api: ApiLike): NoteActions {
    const [busyId, setBusyId] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const act = (id: string, fn: () => Promise<unknown>): void => {
        setBusyId(id);
        run(fn, { errorMessage: s.history.noteChangeError });
    };
    return {
        busyId: busy ? busyId : null,
        error,
        togglePin: (n) => {
            act(n.id, () => api.patch(`/v1/notes/${n.id}`, { pinned: !n.pinned }));
        },
        edit: (n, body) => {
            if (body.trim() === "") return;
            act(n.id, () => api.patch(`/v1/notes/${n.id}`, { body: body.trim() }));
        },
        remove: (n) => {
            act(n.id, () => api.delete(`/v1/notes/${n.id}`));
        },
    };
}

export interface ClientHistory {
    load: Load;
    hasOlder: boolean;
    showOlder: () => void;
    filter: ClientHistoryFilter;
    setFilter: (f: ClientHistoryFilter) => void;
    filters: { key: ClientHistoryFilter; label: string; hint: string }[];
    groups: HistoryGroup[];
    upcoming: HistoryEntry[];
    total: number;
    notes: ClientNote[];
    pinned: ClientNote[];
    pets: SubjectRow[];
}

function visitLabel(v: ClientVisit, pets: readonly SubjectRow[]): string {
    const pet = pets.find((p) => p.id === v.subjectId)?.name ?? null;
    return s.history.visit(v.service, pet);
}

/** Every visit, invoice, payment, message, review and note for one client, newest first. */
export function useClientHistory(clientId: string, viewerStaffId: string | null): ClientHistory {
    const visits = useQuery<VisitRow>(CLIENT_VISITS_SQL, [clientId]);
    const subjects = useQuery<SubjectDbRow>(CLIENT_SUBJECTS_SQL, [clientId]);
    const notes = useQuery<NoteDbRow>(CLIENT_NOTES_SQL, [clientId, clientId]);
    const invoices = useQuery<{
        id: string;
        number: number | null;
        status: string;
        total_cents: number;
        at: string;
    }>(CLIENT_INVOICES_SQL, [clientId]);
    const payments = useQuery<{ id: string; kind: string; amount_cents: number; at: string }>(
        CLIENT_PAYMENTS_SQL,
        [clientId],
    );
    const messages = useQuery<{
        id: string;
        direction: string;
        channel: string;
        body: string | null;
        at: string;
    }>(CLIENT_MESSAGES_SQL, [clientId]);
    const reviews = useQuery<{ id: string; rating: number; body: string | null; at: string }>(
        CLIENT_REVIEWS_SQL,
        [clientId],
    );
    const [months, setMonths] = useState(3);
    const [filter, setFilter] = useState<ClientHistoryFilter>("all");
    const pets = useMemo(() => subjects.data.map(toSubject), [subjects.data]);
    const noteRows = useMemo(
        () => notes.data.map((n) => toNote(n, viewerStaffId)),
        [notes.data, viewerStaffId],
    );

    const { all, upcoming } = useMemo(() => {
        const now = new Date();
        const out: HistoryEntry[] = [];
        const ahead: HistoryEntry[] = [];
        for (const v of visits.data.map(toVisit)) {
            const label = visitLabel(v, pets);
            if (isAhead(v, now)) {
                ahead.push(
                    entry("booked", {
                        key: `up_${v.id}`,
                        at: v.start,
                        label,
                        detail: v.staffName ?? undefined,
                        intent: "accent",
                    }),
                );
                continue;
            }
            if (v.start > now) continue;
            const off =
                v.status === "canceled"
                    ? s.history.canceled
                    : v.status === "no_show"
                      ? s.history.noShow
                      : null;
            out.push(
                entry("visit", {
                    key: v.id,
                    at: v.start,
                    label,
                    detail: [v.staffName, off].filter((x) => x !== null).join(" · ") || undefined,
                    intent:
                        v.status === "no_show"
                            ? "danger"
                            : v.status === "canceled"
                              ? "neutral"
                              : "accent",
                }),
            );
        }
        for (const i of invoices.data) {
            const label =
                i.status === "draft"
                    ? s.history.invoiceDrafted(i.number)
                    : i.status === "void"
                      ? s.history.invoiceVoid(i.number)
                      : s.history.invoiceSent(i.number);
            out.push(
                entry("invoice", {
                    key: i.id,
                    at: parseTimestamp(i.at),
                    label,
                    detail: i.status === "overdue" ? s.history.overdue : undefined,
                    aside: formatMoney(i.total_cents),
                    intent: i.status === "overdue" ? "danger" : "neutral",
                }),
            );
        }
        for (const p of payments.data) {
            const refund = p.kind === "refund";
            out.push(
                entry(refund ? "refund" : "payment", {
                    key: p.id,
                    at: parseTimestamp(p.at),
                    label: refund
                        ? s.history.refundIssued
                        : p.kind === "deposit"
                          ? s.history.depositReceived
                          : s.history.paymentReceived,
                    aside: refund ? `−${formatMoney(p.amount_cents)}` : formatMoney(p.amount_cents),
                    intent: refund ? "warning" : "success",
                }),
            );
        }
        for (const m of messages.data) {
            const inbound = m.direction === "in";
            const label =
                m.channel === "email"
                    ? inbound
                        ? s.history.emailReceived
                        : s.history.emailSent
                    : inbound
                      ? s.history.textReceived
                      : s.history.textSent;
            out.push(
                entry("message", {
                    key: m.id,
                    at: parseTimestamp(m.at),
                    label,
                    quote: m.body ?? undefined,
                }),
            );
        }
        for (const r of reviews.data)
            out.push(
                entry("review", {
                    key: r.id,
                    at: parseTimestamp(r.at),
                    label: s.history.review(r.rating),
                    quote: r.body ?? undefined,
                    intent: r.rating >= 4 ? "success" : "warning",
                }),
            );
        for (const n of noteRows)
            out.push(
                entry("note", {
                    key: n.id,
                    at: n.at,
                    label: n.pinned ? s.history.pinnedNote : s.history.note,
                    quote: n.body,
                    detail: [n.author, n.pet].filter((x) => x !== null).join(" · "),
                }),
            );
        return {
            all: out.sort((a, b) => +b.at - +a.at),
            upcoming: ahead.sort((a, b) => +a.at - +b.at),
        };
    }, [visits.data, invoices.data, payments.data, messages.data, reviews.data, noteRows, pets]);

    const load = useReplicaLoad(
        [visits, notes, invoices, payments, messages],
        all.length + upcoming.length === 0,
    );
    const shown = filter === "all" ? all : all.filter((e) => e.filter === filter);
    const groups: HistoryGroup[] = [];
    for (const e of shown) {
        const key = `${String(e.at.getFullYear())}-${String(e.at.getMonth())}`;
        const group = groups.find((g) => g.key === key);
        if (group === undefined) groups.push({ key, label: formatMonthYear(e.at), entries: [e] });
        else group.entries.push(e);
    }
    const count = (f: ClientHistoryFilter): number =>
        f === "all" ? all.length : all.filter((e) => e.filter === f).length;
    const filters: { key: ClientHistoryFilter; label: string }[] = [
        { key: "all", label: s.history.filterAll },
        { key: "visits", label: s.history.filterVisits },
        { key: "money", label: s.history.filterMoney },
        { key: "messages", label: s.history.filterMessages },
        { key: "notes", label: s.history.filterNotes },
    ];

    return {
        load,
        hasOlder: groups.length > months,
        showOlder: () => {
            setMonths(groups.length);
        },
        filter,
        setFilter,
        filters: filters.map((f) => ({ ...f, hint: String(count(f.key)) })),
        groups: groups.slice(0, months),
        upcoming,
        total: all.length,
        notes: noteRows,
        pinned: noteRows.filter((n) => n.pinned),
        pets,
    };
}

export interface WalletMethod {
    row: SavedCardRow;
    label: string;
    holder: string;
    bankName: string | null;
    status: { label: string; intent: Intent } | null;
    expiry: string | null;
    expiringSoon: boolean;
    isDefault: boolean;
    canBeDefault: boolean;
    pays: string[];
    added: string;
    note: string | null;
}

function walletMethod(row: MethodDbRow, now: Date): WalletMethod {
    const mm = row.exp_month === null ? null : String(row.exp_month).padStart(2, "0");
    const yy = row.exp_year === null ? null : String(row.exp_year).slice(2);
    const lastDay =
        row.exp_month !== null && row.exp_year !== null
            ? new Date(row.exp_year, row.exp_month, 0)
            : null;
    const left = lastDay === null ? null : (lastDay.getTime() - now.getTime()) / 86_400_000;
    const bank = isMandate(row);
    const mandate: Record<string, string> = {
        active: s.wallet.mandateActive,
        pending: s.wallet.mandatePending,
        revoked: s.wallet.mandateRevoked,
    };
    return {
        row,
        label: savedCardLabel(row),
        holder: row.holder_name ?? "",
        bankName: row.bank_name,
        status: bank
            ? {
                  label: mandate[row.mandate_status] ?? row.mandate_status,
                  intent: mandateStatusIntent(row.mandate_status),
              }
            : null,
        expiry:
            mm === null || yy === null || left === null
                ? null
                : left < 0
                  ? s.wallet.expired(mm, yy)
                  : left < 45
                    ? s.wallet.expiresSoon(mm, yy)
                    : s.wallet.expires(mm, yy),
        expiringSoon: left !== null && left < 45,
        isDefault: row.preferred === 1,
        canBeDefault: canBeDefault(row),
        pays: row.pays === null ? [] : row.pays.split(", ").filter((p) => p !== ""),
        added: s.wallet.added(formatDate(parseTimestamp(row.created_at))),
        note: bank && row.mandate_status === "pending" ? s.wallet.mandatePendingNote : null,
    };
}

export interface ClientWallet {
    load: Load;
    methods: WalletMethod[];
    expiring: WalletMethod | null;
    busyId: string | null;
    error: string | null;
    makeDefault: (id: string) => void;
    remove: (id: string) => void;
    removeMessage: (m: WalletMethod) => string;
}

/** A client's saved cards and bank accounts with the details that cause problems: expiry, mandate, plans. */
export function useClientWallet(api: ApiLike, clientId: string): ClientWallet {
    const query = useQuery<MethodDbRow>(CLIENT_METHODS_SQL, [clientId]);
    const methods = useMemo(() => {
        const now = new Date();
        return query.data.map((r) => walletMethod(r, now));
    }, [query.data]);
    const load = useReplicaLoad([query], methods.length === 0);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const act = (id: string, fn: () => Promise<unknown>, message: string): void => {
        setBusyId(id);
        run(fn, { errorMessage: message });
    };
    return {
        load,
        methods,
        expiring: methods.find((m) => m.expiringSoon) ?? null,
        busyId: busy ? busyId : null,
        error,
        makeDefault: (id) => {
            act(id, () => setDefaultCard(api, id), s.wallet.defaultError);
        },
        remove: (id) => {
            act(id, () => detachCard(api, id), s.wallet.removeError);
        },
        removeMessage: (m) =>
            m.pays.length > 0 ? s.wallet.removeBodyInUse(m.pays.join(", ")) : s.wallet.removeBody,
    };
}

interface TagState {
    tag: string;
    count: number;
    on: number;
}

export interface ClientSelection {
    selected: string[];
    toggle: (id: string) => void;
    setAll: (ids: readonly string[]) => void;
    clear: () => void;
    isSelected: (id: string) => boolean;
    tagState: TagState[];
    pendingTags: Record<string, boolean>;
    toggleTag: (tag: string) => void;
    addTag: (tag: string) => void;
    apply: () => void;
    archive: () => void;
    busy: boolean;
    archiving: boolean;
    error: string | null;
    done: string | null;
    canMerge: boolean;
}

/** Multi-select over the list, with the tag state of the selection for a bulk tag editor. */
export function useClientSelection(api: ApiLike, rows: readonly ClientListRow[]): ClientSelection {
    const [selected, setSelected] = useState<string[]>([]);
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [extra, setExtra] = useState<string[]>([]);
    const [done, setDone] = useState<string | null>(null);
    const tagging = useAsyncAction();
    const archiving = useAsyncAction();
    const directory = tagDirectory(rows);
    const tagsOf = (id: string): string[] => rows.find((r) => r.id === id)?.tags ?? [];
    const names = [
        ...directory.map((t) => t.tag),
        ...extra.filter((t) => !directory.some((d) => d.tag === t)),
    ];
    const tagState = names.map((tag) => ({
        tag,
        count: directory.find((t) => t.tag === tag)?.count ?? 0,
        on: selected.filter((id) => tagsOf(id).includes(tag)).length,
    }));
    const reset = (message: string): void => {
        setSelected([]);
        setPending({});
        setExtra([]);
        setDone(message);
    };
    return {
        selected,
        toggle: (id) => {
            setDone(null);
            setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
        },
        setAll: (ids) => {
            setDone(null);
            setSelected([...ids]);
        },
        clear: () => {
            setSelected([]);
            setPending({});
        },
        isSelected: (id) => selected.includes(id),
        tagState,
        pendingTags: pending,
        toggleTag: (tag) => {
            setPending((p) => {
                const current =
                    p[tag] ?? (tagState.find((t) => t.tag === tag)?.on ?? 0) === selected.length;
                return { ...p, [tag]: !current };
            });
        },
        addTag: (raw) => {
            const tag = cleanTag(raw);
            if (tag === "") return;
            if (!names.includes(tag)) setExtra((e) => [...e, tag]);
            setPending((p) => ({ ...p, [tag]: true }));
        },
        apply: () => {
            const ids = selected;
            const set = pending;
            const key = newIdempotencyKey();
            tagging.run(
                () =>
                    api.post("/v1/clients/tags", { client_ids: ids, set }, { idempotencyKey: key }),
                {
                    errorMessage: s.tidy.tagError,
                    onSuccess: () => {
                        reset(s.tidy.tagsUpdated(ids.length));
                    },
                },
            );
        },
        archive: () => {
            const ids = selected;
            const key = newIdempotencyKey();
            archiving.run(
                () => api.post("/v1/clients/archive", { client_ids: ids }, { idempotencyKey: key }),
                {
                    errorMessage: s.tidy.archiveError,
                    onSuccess: () => {
                        reset(s.tidy.archived(ids.length));
                    },
                },
            );
        },
        busy: tagging.busy,
        archiving: archiving.busy,
        error: tagging.error ?? archiving.error,
        done,
        canMerge: selected.length === 2,
    };
}

export const CLIENT_FOOTPRINT_SQL = `
SELECT c.id,
       (SELECT COUNT(*) FROM bookings b WHERE b.client_id = c.id AND b.deleted_at IS NULL) AS bookings,
       (SELECT group_concat(sj.name, ', ') FROM subjects sj
          WHERE sj.client_id = c.id AND sj.deleted_at IS NULL) AS pets,
       (SELECT COUNT(*) FROM subjects sj WHERE sj.client_id = c.id AND sj.deleted_at IS NULL) AS pet_count,
       (SELECT COUNT(*) FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.client_id = c.id) AS messages,
       (SELECT COUNT(*) FROM notes n WHERE n.parent_type = 'client' AND n.parent_id = c.id) AS notes,
       (SELECT COUNT(*) FROM accounts a WHERE a.owner_type = 'client' AND a.owner_id = c.id) AS money,
       (SELECT COUNT(*) FROM payment_methods pm WHERE pm.client_id = c.id AND pm.status = 'active') AS methods
FROM clients c WHERE c.id IN (?, ?)`;

interface FootprintRow {
    id: string;
    bookings: number;
    pets: string | null;
    pet_count: number;
    messages: number;
    notes: number;
    money: number;
    methods: number;
}

type MergeField = "name" | "phone" | "email";
type Side = "a" | "b";

export interface ClientMerge {
    keep: Side;
    setKeep: (side: Side) => void;
    sides: Record<Side, { client: ClientListRow; hint: string }>;
    fields: { key: MergeField; label: string; a: string; b: string; chosen: Side; same: boolean }[];
    choose: (key: MergeField, side: Side) => void;
    moves: string[];
    blocked: string | null;
    keptName: string;
    goneName: string;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** The kept record takes the chosen value per field; everything the other record holds moves over. */
export function useClientMerge(
    api: ApiLike,
    a: ClientListRow,
    b: ClientListRow,
    onMerged: (keptName: string) => void,
): ClientMerge {
    const [keep, setKeepRaw] = useState<Side>("a");
    const [picks, setPicks] = useState<Partial<Record<MergeField, Side>>>({});
    const { busy, error, run } = useAsyncAction();
    const prints = useQuery<FootprintRow>(CLIENT_FOOTPRINT_SQL, [a.id, b.id]).data;
    const printOf = (id: string): FootprintRow | undefined => prints.find((p) => p.id === id);
    const value = (c: ClientListRow, k: MergeField): string =>
        k === "phone" ? formatPhone(c.phone) : k === "email" ? (c.email ?? "") : c.name;
    const fields = (["name", "phone", "email"] as const).map((k) => {
        const va = value(a, k);
        const vb = value(b, k);
        const kept = keep === "a" ? va : vb;
        const fallback: Side = kept === "" ? (keep === "a" ? "b" : "a") : keep;
        return {
            key: k,
            label: s.tidy.field[k],
            a: va,
            b: vb,
            chosen: picks[k] ?? fallback,
            same: va === vb,
        };
    });
    const gone = keep === "a" ? b : a;
    const kept = keep === "a" ? a : b;
    const f = printOf(gone.id);
    const moves =
        f === undefined
            ? []
            : [
                  f.bookings > 0 ? s.tidy.moves.bookings(f.bookings) : null,
                  f.pets !== null && f.pets !== "" ? s.tidy.moves.pets(f.pets) : null,
                  f.messages > 0 ? s.tidy.moves.messages(f.messages) : null,
                  f.notes > 0 ? s.tidy.moves.notes(f.notes) : null,
              ].filter((x): x is string => x !== null);
    const blocked =
        f === undefined
            ? null
            : f.money > 0
              ? s.tidy.blockedMoney
              : f.methods > 0
                ? s.tidy.blockedMethods
                : null;
    const side = (c: ClientListRow): { client: ClientListRow; hint: string } => {
        const p = printOf(c.id);
        return {
            client: c,
            hint: [
                s.tidy.created(formatDate(c.since)),
                p === undefined ? "" : s.tidy.footprint(p.bookings, p.pet_count),
            ]
                .filter((x) => x !== "")
                .join(" · "),
        };
    };
    const nameField = fields[0];
    const keptName = nameField === undefined ? kept.name : nameField[nameField.chosen] || kept.name;
    return {
        keep,
        setKeep: (sd) => {
            setKeepRaw(sd);
            setPicks({});
        },
        sides: { a: side(a), b: side(b) },
        fields,
        choose: (k, sd) => {
            setPicks((p) => ({ ...p, [k]: sd }));
        },
        moves,
        blocked,
        keptName,
        goneName: gone.name,
        busy,
        error,
        submit: () => {
            const key = newIdempotencyKey();
            run(
                () =>
                    api.post(
                        `/v1/clients/${kept.id}/merge`,
                        {
                            from_client_id: gone.id,
                            fields: Object.fromEntries(
                                fields.map((x) => [x.key, x.chosen === keep ? "kept" : "other"]),
                            ),
                        },
                        { idempotencyKey: key },
                    ),
                {
                    errorMessage: s.tidy.mergeError,
                    onSuccess: () => {
                        onMerged(keptName);
                    },
                },
            );
        },
    };
}

/** "Today" or "Wed, Oct 8" for the list's next visit column. */
export function nextVisitLabel(next: Date | null): string {
    return next === null ? s.record.noUpcoming : relativeDay(next);
}
