import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks";
import type { AuthTokens, Viewer } from "./auth";
import { strings } from "../strings";
import type { ApiLike } from "../api";

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

export const PENDING_INVITES_SQL = `SELECT ${STAFF_COLS} FROM staff WHERE status = 'invited' ORDER BY created_at DESC`;

export function useStaff(): StaffRow[] {
    return useQuery<StaffRow>(STAFF_SQL).data;
}

export function usePendingInvites(): StaffRow[] {
    return useQuery<StaffRow>(PENDING_INVITES_SQL).data;
}

export function staffLabel(s: StaffRow): string {
    const t = s.title ?? "";
    return t.length > 0 ? t : s.role;
}

/** Best display name for the Team list: title → invited email → role. */
export function staffDisplayName(s: Pick<StaffRow, "title" | "invite_email" | "role">): string {
    return s.title ?? s.invite_email ?? s.role;
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

/** Whose hours the viewer may edit: everyone for a manager, else only their own. */
export function editableStaff(staff: StaffRow[], viewer: Viewer | null): StaffRow[] {
    if (viewer === null) return [];
    return canManageStaff(viewer.role) ? staff : staff.filter((s) => s.id === viewer.staffId);
}

type StaffRole = "admin" | "staff" | "contractor";

export const INVITABLE_ROLES: { value: StaffRole; label: string }[] = [
    { value: "staff", label: strings.staff.roleStaff },
    { value: "admin", label: strings.staff.roleAdmin },
    { value: "contractor", label: strings.staff.roleContractor },
];

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
    role: StaffRole;
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

export interface InviteForm {
    email: string;
    setEmail: (v: string) => void;
    role: StaffRole;
    setRole: (v: StaffRole) => void;
    busy: boolean;
    error: string | null;
    /** The most recent invite (its raw token / link to copy), cleared when a new one starts. */
    invite: Invite | null;
    submit: () => void;
    reset: () => void;
}

export function useInviteForm(api: ApiLike, onInvited?: (invite: Invite) => void): InviteForm {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<StaffRole>("staff");
    const [invite, setInvite] = useState<Invite | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (email.trim().length === 0) {
            setError(strings.staff.emailRequired);
            return;
        }
        run(
            async () => {
                const created = await inviteStaff(api, { email, role });
                setInvite(created);
                setEmail("");
                onInvited?.(created);
            },
            { errorMessage: strings.staff.inviteError },
        );
    };

    const reset = (): void => {
        setInvite(null);
        setError(null);
    };

    return { email, setEmail, role, setRole, busy, error, invite, submit, reset };
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
