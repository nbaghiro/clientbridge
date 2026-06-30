import {
    type Invite,
    type StaffRole,
    INVITABLE_ROLES,
    acceptInviteUrl,
    canManageStaff,
    decodeJwtSub,
    staffDisplayName,
    useCurrentRole,
    useInviteForm,
    usePendingInvites,
    useStaff,
} from "@clientbridge/app-core";
import { useState } from "react";

import { api } from "../lib/api";
import { getTokens } from "../lib/auth";

export function Team() {
    const accessToken = getTokens()?.access_token ?? null;
    const role = useCurrentRole(accessToken);
    const myUserId = decodeJwtSub(accessToken);
    const staff = useStaff();
    const pending = usePendingInvites();
    const invite = useInviteForm(api);

    return (
        <div className="max-w-2xl">
            <h1 className="font-display text-xl font-bold text-ink">Team</h1>
            <p className="mt-1 text-sm text-muted">
                Invite colleagues and manage who can access your business.
            </p>

            <section className="mt-6 rounded-lg border border-line bg-surface">
                <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                    Members
                </h2>
                <ul>
                    {staff.map((s) => (
                        <li
                            key={s.id}
                            className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0"
                        >
                            <div>
                                <p className="text-sm font-medium text-ink">
                                    {staffDisplayName(s)}
                                    {s.user_id !== null && s.user_id === myUserId ? (
                                        <span className="ml-2 rounded-full bg-accent-weak px-2 py-0.5 text-xs font-semibold text-accent">
                                            You
                                        </span>
                                    ) : null}
                                </p>
                                {s.invite_email !== null ? (
                                    <p className="text-xs text-muted">{s.invite_email}</p>
                                ) : null}
                            </div>
                            <span className="text-xs font-medium capitalize text-ink-soft">
                                {s.role}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            {pending.length > 0 ? (
                <section className="mt-6 rounded-lg border border-line bg-surface">
                    <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                        Pending invites
                    </h2>
                    <ul>
                        {pending.map((s) => (
                            <li
                                key={s.id}
                                className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0"
                            >
                                <p className="text-sm text-ink">{s.invite_email ?? "—"}</p>
                                <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold capitalize text-warn-fg">
                                    {s.role} · invited
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {canManageStaff(role) ? (
                <InviteForm invite={invite} />
            ) : (
                <p className="mt-6 text-sm text-muted">
                    Only owners and admins can invite teammates.
                </p>
            )}
        </div>
    );
}

function InviteForm({ invite }: { invite: ReturnType<typeof useInviteForm> }) {
    return (
        <section className="mt-6 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Invite a teammate</h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    invite.submit();
                }}
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
            >
                <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-ink-soft">
                    Email
                    <input
                        type="email"
                        value={invite.email}
                        onChange={(e) => {
                            invite.setEmail(e.target.value);
                        }}
                        placeholder="teammate@example.com"
                        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none transition placeholder:text-muted focus:border-accent"
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                    Role
                    <select
                        value={invite.role}
                        onChange={(e) => {
                            invite.setRole(e.target.value as StaffRole);
                        }}
                        className="rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none transition focus:border-accent"
                    >
                        {INVITABLE_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                                {r.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="submit"
                    disabled={invite.busy}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {invite.busy ? "Inviting…" : "Send invite"}
                </button>
            </form>

            {invite.error ? <p className="mt-2 text-sm text-danger-fg">{invite.error}</p> : null}
            {invite.invite ? <InviteLink invite={invite.invite} onDone={invite.reset} /> : null}
        </section>
    );
}

function InviteLink({ invite, onDone }: { invite: Invite; onDone: () => void }) {
    const [copied, setCopied] = useState(false);
    const link = acceptInviteUrl(window.location.origin, invite.invite_token);

    const copy = (): void => {
        void navigator.clipboard.writeText(link).then(() => {
            setCopied(true);
        });
    };

    return (
        <div className="mt-3 rounded-md border border-accent-line bg-accent-weak p-3">
            <p className="text-sm font-medium text-ink">
                Invite sent to {invite.email}. Share this link so they can join:
            </p>
            <div className="mt-2 flex items-center gap-2">
                <input
                    readOnly
                    value={link}
                    className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft"
                />
                <button
                    type="button"
                    onClick={copy}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {copied ? "Copied" : "Copy"}
                </button>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-surface"
                >
                    Done
                </button>
            </div>
        </div>
    );
}
