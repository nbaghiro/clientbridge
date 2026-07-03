import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { AuthTokens } from "../hooks/useLogin";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";

export interface StaffRow {
    id: string;
    user_id: string | null;
    title: string | null;
    role: string;
    color: string | null;
    status: string;
    invite_email: string | null;
}

const STAFF_COLS = "id, user_id, title, role, color, status, invite_email";

export function useStaff(): StaffRow[] {
    return useQuery<StaffRow>(
        `SELECT ${STAFF_COLS} FROM staff WHERE status = 'active' ORDER BY role`,
    ).data;
}

/** Pending (invited, not-yet-accepted) staff — shown in the Team list alongside the active members. */
export function usePendingInvites(): StaffRow[] {
    return useQuery<StaffRow>(
        `SELECT ${STAFF_COLS} FROM staff WHERE status = 'invited' ORDER BY created_at DESC`,
    ).data;
}

export function staffLabel(s: StaffRow): string {
    const t = s.title ?? "";
    return t.length > 0 ? t : s.role;
}

/** Best display name for the Team list: title → invited email → role. */
export function staffDisplayName(s: StaffRow): string {
    return s.title ?? s.invite_email ?? s.role;
}

/** Only owners and admins may invite/manage staff (matches the backend's owner/admin invite gate). */
export function canManageStaff(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

export type StaffRole = "admin" | "staff" | "contractor";

export const INVITABLE_ROLES: { value: StaffRole; label: string }[] = [
    { value: "staff", label: strings.team.roleStaff },
    { value: "admin", label: strings.team.roleAdmin },
    { value: "contractor", label: strings.team.roleContractor },
];

/** Matches the backend InviteOut; `invite_token` is the raw token, returned once to the inviter. */
export interface Invite {
    id: string;
    email: string;
    role: string;
    status: string;
    invite_token: string;
}

export interface InviteInput {
    email: string;
    role: StaffRole;
}

/** Create a staff invite (POST /v1/staff/invites). Owner/admin only (the server enforces the gate). */
export function inviteStaff(api: ApiLike, input: InviteInput): Promise<Invite> {
    return api.post<Invite>("/v1/staff/invites", {
        email: input.email.trim(),
        role: input.role,
    });
}

export interface AcceptInviteInput {
    token: string;
    name?: string;
    password: string;
}

/** Accept an emailed invite (POST /auth/accept-invite) — creates/links the user and returns a session
 *  (the invitee is logged straight into the business they joined). */
export function acceptInvite(api: ApiLike, input: AcceptInviteInput): Promise<AuthTokens> {
    return api.post<AuthTokens>("/auth/accept-invite", {
        token: input.token,
        name: input.name?.trim() ?? null,
        password: input.password,
    });
}

/** The shareable accept-invite link for a raw invite token (`base` = each app's public-web origin). */
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

/** Invite-a-teammate view-model: email + role + submit, surfacing the created invite (token/link). */
export function useInviteForm(api: ApiLike, onInvited?: (invite: Invite) => void): InviteForm {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<StaffRole>("staff");
    const [invite, setInvite] = useState<Invite | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (email.trim().length === 0) {
            setError(strings.team.emailRequired);
            return;
        }
        run(
            async () => {
                const created = await inviteStaff(api, { email, role });
                setInvite(created);
                setEmail("");
                onInvited?.(created);
            },
            { errorMessage: strings.team.inviteError },
        );
    };

    const reset = (): void => {
        setInvite(null);
        setError(null);
    };

    return { email, setEmail, role, setRole, busy, error, invite, submit, reset };
}

export interface AcceptInviteForm {
    name: string;
    setName: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Accept-invite view-model for the public emailed-link page: name + password + submit; `setTokens`
 *  is injected (web sync, mobile async) and `onSuccess` flips the app into its authed state. */
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
            setError(strings.team.inviteMissingCode);
            return;
        }
        if (password.length < 8) {
            setError(strings.team.passwordTooShort);
            return;
        }
        run(
            async () => {
                await setTokens(await acceptInvite(api, { token, name, password }));
            },
            {
                onSuccess,
                errorMessage: strings.team.acceptInviteError,
            },
        );
    };

    return { name, setName, password, setPassword, busy, error, submit };
}
