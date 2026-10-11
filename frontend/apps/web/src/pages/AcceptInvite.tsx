import { strings, useAcceptInvite } from "@clientbridge/app-core";
import { Button, Lockup, Notice } from "@clientbridge/ui";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, selectBusiness } from "../lib/api";
import { getUserId, heldInvite, holdInvite, releaseInvite } from "../lib/auth";

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
    const linked = params.get("token");
    const [token] = useState(() => {
        if (linked) holdInvite(linked);
        return linked ?? heldInvite() ?? "";
    });
    const signedIn = getUserId() !== null;
    const go = (to: string): void => {
        const navigated = navigate(to, { replace: true });
        if (navigated) navigated.catch(() => undefined);
    };
    const invite = useAcceptInvite(api, token, (businessId) => {
        releaseInvite();
        selectBusiness(businessId);
        go("/");
        onAuthed();
    });
    useEffect(() => {
        if (linked) go("/accept-invite");
    }, []);
    useEffect(() => {
        const settled = ["invalid", "expired", "accepted", "member"];
        if (invite.problem !== null && settled.includes(invite.problem)) releaseInvite();
    }, [invite.problem]);
    const query = (path: string): string =>
        `${path}?email=${encodeURIComponent(invite.preview?.email ?? "")}`;

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
