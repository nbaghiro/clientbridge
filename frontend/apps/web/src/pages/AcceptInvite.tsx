import { strings, useAcceptInvite } from "@clientbridge/app-core";
import { Button, Lockup, Notice } from "@clientbridge/ui";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, selectBusiness } from "../lib/api";
import { getUserId } from "../lib/auth";

const s = strings.staff;

/** Signed out, it shows the invite and sends you to sign up or in; signed in, it joins the team. */
export function AcceptInvite({
    onAuthed,
    onSignOut,
}: {
    onAuthed: () => void;
    onSignOut?: () => void;
}) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get("token") ?? "";
    const signedIn = getUserId() !== null;
    const go = (to: string): void => {
        const navigated = navigate(to, { replace: true });
        if (navigated) navigated.catch(() => undefined);
    };
    const invite = useAcceptInvite(api, token, (businessId) => {
        selectBusiness(businessId);
        go("/");
        onAuthed();
    });
    const query = (path: string): string =>
        `${path}?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.preview?.email ?? "")}`;

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-sm">
                <Lockup className="mb-8 text-lg text-ink" />
                <h1 className="font-display text-2xl font-bold text-ink">{s.inviteTitle}</h1>
                {invite.preview ? (
                    <p className="mt-1 text-sm text-muted">
                        {s.inviteFrom(invite.preview.business_name)}{" "}
                        {s.inviteFor(invite.preview.email)}
                    </p>
                ) : null}

                <div className="mt-6 flex flex-col gap-3">
                    {invite.problem !== null ? (
                        <Notice tone="danger" banner>
                            {s.inviteProblem[invite.problem]}
                        </Notice>
                    ) : null}
                    {invite.error !== null ? (
                        <Notice tone="danger" banner>
                            {invite.error}
                        </Notice>
                    ) : null}

                    {invite.problem === "unverified" ? (
                        <Button
                            size="lg"
                            full
                            onPress={() => {
                                go("/verify");
                            }}
                        >
                            {s.inviteVerify}
                        </Button>
                    ) : null}
                    {invite.problem === "mismatch" && onSignOut ? (
                        <Button
                            size="lg"
                            full
                            variant="outline"
                            onPress={() => {
                                onSignOut();
                                go(query("/login"));
                            }}
                        >
                            {s.inviteSignOut}
                        </Button>
                    ) : null}

                    {invite.preview && invite.problem === null ? (
                        signedIn ? (
                            <Button size="lg" full busy={invite.busy} onPress={invite.accept}>
                                {invite.busy ? s.inviteJoining : s.inviteJoin}
                            </Button>
                        ) : (
                            <>
                                <Button
                                    size="lg"
                                    full
                                    onPress={() => {
                                        go(query("/signup"));
                                    }}
                                >
                                    {s.inviteSignUp}
                                </Button>
                                <Button
                                    size="lg"
                                    full
                                    variant="outline"
                                    onPress={() => {
                                        go(query("/login"));
                                    }}
                                >
                                    {s.inviteSignIn}
                                </Button>
                            </>
                        )
                    ) : null}
                </div>
            </div>
        </div>
    );
}
