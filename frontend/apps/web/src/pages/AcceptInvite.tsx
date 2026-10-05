import { strings, useAcceptInviteForm } from "@clientbridge/app-core";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, Lockup, Notice, TextField } from "@clientbridge/ui";
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
                    <div className="mt-6">
                        <Notice tone="danger">{strings.auth.inviteMissingCode}</Notice>
                    </div>
                ) : (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            form.submit();
                        }}
                        className="mt-6 flex flex-col gap-4"
                    >
                        <TextField
                            label={strings.auth.inviteName}
                            value={form.name}
                            onChange={form.setName}
                            placeholder={strings.auth.namePlaceholder}
                            autoComplete="name"
                            size="lg"
                        />
                        <TextField
                            label={strings.auth.password}
                            type="password"
                            value={form.password}
                            onChange={form.setPassword}
                            placeholder={strings.auth.passwordPlaceholder}
                            autoComplete="new-password"
                            size="lg"
                        />

                        {form.error ? <Notice tone="danger">{form.error}</Notice> : null}

                        <Button submit size="lg" full busy={form.busy}>
                            {form.busy ? strings.auth.joining : strings.auth.joinTeam}
                        </Button>
                    </form>
                )}
            </div>
        </div>
    );
}
