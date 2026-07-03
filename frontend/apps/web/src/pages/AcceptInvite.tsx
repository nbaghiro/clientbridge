import { strings, useAcceptInviteForm } from "@clientbridge/app-core";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Logo } from "../components/icons";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth";

/** Public page an invitee lands on from the emailed link (`/accept-invite?token=…`). Setting a
 *  password creates/links their account and signs them straight into the business they joined. */
export function AcceptInvite({ onAuthed }: { onAuthed: () => void }) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get("token") ?? "";

    const form = useAcceptInviteForm(api, token, setTokens, () => {
        onAuthed();
        // RR types navigate as void | Promise<void>; handle the promise branch when there is one.
        const navigated = navigate("/", { replace: true });
        if (navigated) navigated.catch(() => undefined);
    });

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-none transition placeholder:text-muted focus:border-accent";

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-sm">
                <div className="mb-8 flex items-center gap-2">
                    <Logo className="h-7 w-7 text-accent" />
                    <span className="text-lg font-bold tracking-tight text-ink">Clientbridge</span>
                </div>

                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.auth.inviteTitle}
                </h1>
                <p className="mt-1 text-sm text-muted">{strings.auth.inviteSubtitle}</p>

                {token.length === 0 ? (
                    <p className="mt-6 text-sm text-danger-fg">{strings.auth.inviteMissingCode}</p>
                ) : (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            form.submit();
                        }}
                        className="mt-6 flex flex-col gap-4"
                    >
                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            {strings.auth.inviteName}
                            <input
                                value={form.name}
                                onChange={(e) => {
                                    form.setName(e.target.value);
                                }}
                                placeholder={strings.auth.namePlaceholder}
                                autoComplete="name"
                                className={field}
                            />
                        </label>

                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            {strings.auth.password}
                            <input
                                type="password"
                                value={form.password}
                                onChange={(e) => {
                                    form.setPassword(e.target.value);
                                }}
                                placeholder={strings.auth.passwordPlaceholder}
                                autoComplete="new-password"
                                className={field}
                            />
                        </label>

                        {form.error ? <p className="text-sm text-danger-fg">{form.error}</p> : null}

                        <button
                            type="submit"
                            disabled={form.busy}
                            className="mt-1 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy ? strings.auth.joining : strings.auth.joinTeam}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
