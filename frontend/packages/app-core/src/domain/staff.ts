import { useQuery } from "@powersync/react";
import { useState } from "react";

import { parseTimestamp } from "../datetime";
import { type Load, useAsyncAction, useRemote } from "../hooks";
import type { Intent } from "../ui";
import type { AuthTokens, Viewer } from "./auth";
import { useReplicaLoad } from "./sync";
import { strings } from "../strings";
import type { ApiLike } from "../api";

export type MemberRole = "owner" | "admin" | "staff" | "contractor";

export const INVITE_ROLES: MemberRole[] = ["admin", "staff", "contractor"];
const ROLE_ORDER: MemberRole[] = ["owner", "admin", "staff", "contractor"];

export function memberRoleIntent(role: string): Intent {
    return role === "owner" ? "accent" : role === "admin" ? "success" : "neutral";
}

interface TeamApiMember {
    id: string;
    email: string | null;
    last_active_at: string | null;
    invited_by_name: string | null;
}

export interface TeamMember {
    id: string;
    name: string;
    title: string | null;
    color: string | null;
    role: MemberRole;
    email: string | null;
    isYou: boolean;
    activeLabel: string;
    activeNow: boolean;
}

export interface TeamInvite {
    id: string;
    email: string;
    role: MemberRole;
    expired: boolean;
    daysLeft: number;
    sentLine: string;
}

export interface TeamView {
    load: Load;
    alone: boolean;
    members: TeamMember[];
    invites: TeamInvite[];
    canManage: boolean;
    viewerRole: MemberRole | null;
    ownerName: string | null;
    busyId: string | null;
    resentIds: string[];
    error: string | null;
    resend: (id: string) => void;
    revoke: (id: string) => void;
    remove: (id: string) => void;
    changeRole: (id: string, role: MemberRole) => void;
}

export const TEAM_SQL = `
SELECT id, user_id, name, title, role, color, status, invite_email, invited_at, created_at
FROM staff WHERE status IN ('active', 'invited') ORDER BY created_at`;

interface TeamRow {
    id: string;
    user_id: string | null;
    name: string | null;
    title: string | null;
    role: string;
    color: string | null;
    status: string;
    invite_email: string | null;
    invited_at: string | null;
    created_at: string;
}

const INVITE_DAYS = 7;
const DAY_MS = 86_400_000;

function sinceLabel(at: string, now: Date): string {
    const mins = (now.getTime() - parseTimestamp(at).getTime()) / 60_000;
    if (mins < 60) return strings.common.relativeTime.minutes(Math.max(1, Math.floor(mins)));
    if (mins < 1440) return strings.common.relativeTime.hours(Math.floor(mins / 60));
    return strings.common.relativeTime.days(Math.floor(mins / 1440));
}

/** Members from the replica; emails and last activity come from the server for managers. */
export function useTeam(api: ApiLike, viewer: Viewer | null): TeamView {
    const t = strings.staff.team;
    const query = useQuery<TeamRow>(TEAM_SQL);
    const rows = query.data;
    const canManage = canManageStaff(viewer?.role ?? null);
    const remote = useRemote(
        () =>
            canManage
                ? api.get<{ members: TeamApiMember[]; invites: TeamApiMember[] }>("/v1/staff/team")
                : Promise.resolve({ members: [], invites: [] }),
        `${String(canManage)}:${String(rows.length)}`,
    );
    const load = useReplicaLoad([query], rows.length === 0);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [resentIds, setResentIds] = useState<string[]>([]);
    const { error, run } = useAsyncAction();
    const extra = new Map(
        [...(remote.data?.members ?? []), ...(remote.data?.invites ?? [])].map((m) => [m.id, m]),
    );
    const now = new Date();
    const members: TeamMember[] = rows
        .filter((r) => r.status === "active")
        .map((r) => {
            const info = extra.get(r.id);
            const last = info?.last_active_at ?? null;
            const recent =
                last !== null && now.getTime() - parseTimestamp(last).getTime() < 15 * 60_000;
            return {
                id: r.id,
                name: staffName(r),
                title: r.title,
                color: r.color,
                role: r.role as MemberRole,
                email: info?.email ?? null,
                isYou: r.id === viewer?.staffId,
                activeNow: recent,
                activeLabel:
                    last === null
                        ? canManage
                            ? t.neverSignedIn
                            : ""
                        : recent
                          ? t.activeNow
                          : t.activeAgo(sinceLabel(last, now)),
            };
        })
        .sort(
            (a, b) =>
                ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
                a.name.localeCompare(b.name),
        );
    const invites: TeamInvite[] = canManage
        ? rows
              .filter((r) => r.status === "invited")
              .map((r) => {
                  const sent = parseTimestamp(r.invited_at ?? r.created_at);
                  const leftMs = sent.getTime() + INVITE_DAYS * DAY_MS - now.getTime();
                  const by = extra.get(r.id)?.invited_by_name ?? null;
                  const ago = sinceLabel(r.invited_at ?? r.created_at, now);
                  return {
                      id: r.id,
                      email: r.invite_email ?? "",
                      role: r.role as MemberRole,
                      expired: leftMs <= 0,
                      daysLeft: leftMs <= 0 ? 0 : Math.max(1, Math.floor(leftMs / DAY_MS)),
                      sentLine: by === null ? t.invited(ago) : t.invitedBy(by, ago),
                  };
              })
        : [];
    const act = (id: string, fn: () => Promise<unknown>, after?: () => void): void => {
        setBusyId(id);
        run(fn, {
            errorMessage: t.actionError,
            onSuccess: () => {
                setBusyId(null);
                after?.();
                remote.refresh().catch(() => undefined);
            },
        });
    };
    const owner = members.find((m) => m.role === "owner");
    return {
        load,
        alone: members.length === 1 && invites.length === 0,
        members,
        invites,
        canManage,
        viewerRole: (viewer?.role ?? null) as MemberRole | null,
        ownerName: owner?.name ?? null,
        busyId,
        resentIds,
        error,
        resend: (id) => {
            act(
                id,
                () => api.post(`/v1/staff/invites/${id}/resend`, {}),
                () => {
                    setResentIds((r) => [...r, id]);
                },
            );
        },
        revoke: (id) => {
            act(id, () => api.post(`/v1/staff/invites/${id}/revoke`, {}));
        },
        remove: (id) => {
            act(id, () => api.delete(`/v1/staff/${id}`));
        },
        changeRole: (id, role) => {
            act(id, () => api.patch(`/v1/staff/${id}`, { role }));
        },
    };
}

export interface InviteTeammatesForm {
    emails: string;
    setEmails: (v: string) => void;
    role: MemberRole;
    setRole: (r: MemberRole) => void;
    error: string | null;
    busy: boolean;
    sent: Invite[];
    submit: () => void;
    reset: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Several emails at once, each invited with the same role. */
export function useInviteTeammatesForm(
    api: ApiLike,
    existing: readonly string[],
): InviteTeammatesForm {
    const t = strings.staff.team;
    const [emails, setEmails] = useState("");
    const [role, setRole] = useState<MemberRole>("staff");
    const [sent, setSent] = useState<Invite[]>([]);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        emails,
        setEmails: (v) => {
            setEmails(v);
            setError(null);
        },
        role,
        setRole,
        error,
        busy,
        sent,
        submit: () => {
            const list = [
                ...new Set(
                    emails
                        .split(/[\s,;]+/)
                        .map((e) => e.trim().toLowerCase())
                        .filter((e) => e !== ""),
                ),
            ];
            if (list.length === 0) {
                setError(t.emailRequired);
                return;
            }
            const bad = list.find((e) => !EMAIL.test(e));
            if (bad !== undefined) {
                setError(t.emailInvalid(bad));
                return;
            }
            const dupe = list.find((e) => existing.includes(e));
            if (dupe !== undefined) {
                setError(t.alreadyMember(dupe));
                return;
            }
            run(
                async () => {
                    const made: Invite[] = [];
                    for (const email of list) made.push(await inviteStaff(api, { email, role }));
                    setSent(made);
                    setEmails("");
                },
                { errorMessage: t.inviteError },
            );
        },
        reset: () => {
            setSent([]);
            setError(null);
        },
    };
}

export interface StaffRow {
    id: string;
    user_id: string | null;
    name: string | null;
    title: string | null;
    role: string;
    color: string | null;
    status: string;
    invite_email: string | null;
}

const STAFF_COLS = "id, user_id, name, title, role, color, status, invite_email";

export const STAFF_SQL = `SELECT ${STAFF_COLS} FROM staff WHERE status = 'active' ORDER BY role`;

export function useStaff(): StaffRow[] {
    return useQuery<StaffRow>(STAFF_SQL).data;
}

/** A member's name for the schedule and Today: their name, else their title, invite email or role. */
export function staffName(s: {
    name: string | null;
    title: string | null;
    role: string;
    invite_email?: string | null;
}): string {
    return s.name ?? s.title ?? s.invite_email ?? s.role;
}

export function canManageStaff(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

type StaffRole = "admin" | "staff" | "contractor";

/** Matches the backend InviteOut; `invite_token` is the raw token, returned once to the inviter. */
export interface Invite {
    id: string;
    email: string;
    role: string;
    status: string;
    invite_token: string;
}

interface InviteInput {
    email: string;
    role: StaffRole | MemberRole;
}

function inviteStaff(api: ApiLike, input: InviteInput): Promise<Invite> {
    return api.post<Invite>("/v1/staff/invites", {
        email: input.email.trim(),
        role: input.role,
    });
}

interface AcceptInviteInput {
    token: string;
    name?: string;
    password: string;
}

/** Creates or links the user and returns a session in the business they joined. */
export function acceptInvite(api: ApiLike, input: AcceptInviteInput): Promise<AuthTokens> {
    return api.post<AuthTokens>("/auth/accept-invite", {
        token: input.token,
        name: input.name?.trim() ?? null,
        password: input.password,
    });
}

export function acceptInviteUrl(base: string, token: string): string {
    return `${base.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;
}

interface AcceptInviteForm {
    name: string;
    setName: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** `setTokens` is injected because web stores tokens synchronously and mobile asynchronously. */
export function useAcceptInviteForm(
    api: ApiLike,
    token: string,
    setTokens: (tokens: AuthTokens) => void | Promise<void>,
    onSuccess: () => void,
): AcceptInviteForm {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (token.length === 0) {
            setError(strings.staff.inviteMissingCode);
            return;
        }
        if (password.length < 8) {
            setError(strings.staff.passwordTooShort);
            return;
        }
        run(
            async () => {
                await setTokens(await acceptInvite(api, { token, name, password }));
            },
            {
                onSuccess,
                errorMessage: strings.staff.acceptInviteError,
            },
        );
    };

    return { name, setName, password, setPassword, busy, error, submit };
}

export interface StaffPayRow {
    id: string;
    title: string | null;
    role: string;
    invite_email: string | null;
    payee: number | null;
    rate_type: string | null;
    rate_bps: number | null;
    rate_cents: number | null;
    retail_rate_bps: number | null;
}

// Pay columns reach owner/admin devices only (business_full); staff devices read them as NULL.
export const STAFF_PAY_SQL = `
SELECT id, title, role, invite_email, payee, rate_type, rate_bps, rate_cents, retail_rate_bps
FROM staff WHERE status = 'active' ORDER BY role`;

export function useStaffPay(): StaffPayRow[] {
    return useQuery<StaffPayRow>(STAFF_PAY_SQL).data;
}

export const RATE_TYPES: { value: string; label: string }[] = [
    { value: "percent", label: strings.staff.ratePercent },
    { value: "fixed", label: strings.staff.rateFixed },
    { value: "hourly", label: strings.staff.rateHourly },
];

/** The service rate as typed: percentage points for `percent`, dollars for `fixed` and `hourly`. */
function rateValue(row: StaffPayRow): number | null {
    const stored = row.rate_type === "percent" ? row.rate_bps : row.rate_cents;
    return stored === null ? null : stored / 100;
}

export function staffPaySummary(row: StaffPayRow): string {
    if (row.payee !== 1) return strings.staff.notPaid;
    const rate = rateValue(row) ?? 0;
    const service =
        row.rate_type === "percent"
            ? strings.staff.payPercent(rate)
            : row.rate_type === "hourly"
              ? strings.staff.payHourly(rate.toFixed(2))
              : strings.staff.payFixed(rate.toFixed(2));
    const retail = row.retail_rate_bps ?? 0;
    return retail > 0 ? strings.staff.payWithRetail(service, retail / 100) : service;
}

interface StaffPayForm {
    isPayee: boolean;
    setIsPayee: (v: boolean) => void;
    rateType: string;
    setRateType: (v: string) => void;
    rate: string;
    setRate: (v: string) => void;
    retailPercent: string;
    setRetailPercent: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Owner and admin only; the server enforces it. */
export function useStaffPayForm(api: ApiLike, row: StaffPayRow, onDone: () => void): StaffPayForm {
    const [isPayee, setIsPayee] = useState(row.payee === 1);
    const [rateType, setRateType] = useState(row.rate_type ?? "percent");
    const [rate, setRate] = useState(() => {
        const value = rateValue(row);
        return value === null ? "" : String(value);
    });
    const [retailPercent, setRetailPercent] = useState(
        row.retail_rate_bps === null ? "" : String(row.retail_rate_bps / 100),
    );
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        const amount = rate.trim() === "" ? null : Number(rate);
        const retail = retailPercent.trim() === "" ? 0 : Number(retailPercent);
        const badRate = amount !== null && (!Number.isFinite(amount) || amount < 0);
        if (badRate || (rateType === "percent" && amount !== null && amount > 100)) {
            setError(strings.staff.rateInvalid);
            return;
        }
        if (!Number.isFinite(retail) || retail < 0 || retail > 100) {
            setError(strings.staff.retailInvalid);
            return;
        }
        run(
            () =>
                api.patch(`/v1/staff/${row.id}/pay`, {
                    payee: isPayee,
                    rate_type: rateType,
                    rate_bps:
                        rateType === "percent" && amount !== null ? Math.round(amount * 100) : null,
                    rate_cents:
                        rateType !== "percent" && amount !== null ? Math.round(amount * 100) : null,
                    retail_rate_bps: Math.round(retail * 100),
                }),
            { onSuccess: onDone, errorMessage: strings.staff.payError },
        );
    };

    return {
        isPayee,
        setIsPayee,
        rateType,
        setRateType,
        rate,
        setRate,
        retailPercent,
        setRetailPercent,
        busy,
        error,
        submit,
    };
}
