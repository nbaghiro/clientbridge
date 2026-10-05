import { strings, useAcceptInviteForm } from "@clientbridge/app-core";
import { useNavigate, useSearchParams } from "react-router-dom";

import { fieldLarge, Lockup, primaryButtonLarge } from "@clientbridge/ui";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth";

/** Setting a password creates or links the account and signs the invitee into the business. */
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

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-sm">
                <Lockup className="mb-8 text-lg text-ink" />

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
                                className={fieldLarge}
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
                                className={fieldLarge}
                            />
                        </label>

                        {form.error ? <p className="text-sm text-danger-fg">{form.error}</p> : null}

                        <button
                            type="submit"
                            disabled={form.busy}
                            className={`${primaryButtonLarge} mt-1`}
                        >
                            {form.busy ? strings.auth.joining : strings.auth.joinTeam}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
