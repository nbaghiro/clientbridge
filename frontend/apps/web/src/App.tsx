import type { ReactNode } from "react";
import {
    BusinessZoneContext,
    checkSession,
    strings,
    useBusinessLoad,
    useBusinessSelection,
    useReplicaSession,
} from "@clientbridge/app-core";
import { PowerSyncContext } from "@powersync/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DebugPanel } from "./components/DebugPanel";
import { config } from "./config";
import { AuthError, Login, VerifyEmail } from "./pages/Login";
import { Button, ConfirmHost, LoadFailed, Logo, Select } from "@clientbridge/ui";
import { api, identity, onSignedOut, selectBusiness } from "./lib/api";
import {
    clearUser,
    verifiedAt,
    getUserId,
    onSessionChanged,
    rememberUser,
    sessionExpected,
} from "./lib/auth";
import { connectPowerSync, replica, signOut } from "./lib/powersync";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Schedule } from "./pages/Schedule";
import { Classes } from "./pages/Classes";
import { Recurrences } from "./pages/Recurrences";
import { Clients } from "./pages/Clients";
import { Inbox } from "./pages/Inbox";
import { Onboarding } from "./pages/Onboarding";
import { Payments } from "./pages/Payments";
import { Setup } from "./pages/Setup";
import { Today } from "./pages/Today";

async function endSession(): Promise<void> {
    await clearUser();
    await identity.signOut().catch(() => undefined);
}

const lifecycle = {
    validate: async (stale: () => boolean) => {
        const session = await checkSession(api.forBusiness(null), getUserId(), verifiedAt());
        if (stale()) return;
        if (session.state !== "user") throw new Error("session requires attention");
        await rememberUser(session.userId, session.verifiedAt);
    },
    subscribeResume: (refresh: () => void) => {
        window.addEventListener("focus", refresh);
        return () => {
            window.removeEventListener("focus", refresh);
        };
    },
    restore: async (stale: () => boolean) => {
        const session = sessionExpected()
            ? await checkSession(api.forBusiness(null), getUserId(), verifiedAt())
            : { state: "none" as const };
        // A replaced restore (development runs effects twice) must not touch the replica.
        if (stale()) return null;
        if (session.state !== "user") {
            await replica.pause();
            return session.state === "unverified" ? "unverified" : null;
        }
        await rememberUser(session.userId, session.verifiedAt);
        if (stale()) return null;
        return connectPowerSync(api);
    },
    pause: () => replica.pause(),
    discard: async () => {
        await endSession();
        await signOut();
    },
    subscribe: onSignedOut,
    clearCredentials: endSession,
    subscribeChanged: onSessionChanged,
};

export function App() {
    const { db, loading, failed, unverified, restore, discard, retry, reauthenticate } =
        useReplicaSession(lifecycle);
    return (
        <BrowserRouter>
            {loading ? (
                <Splash />
            ) : unverified ? (
                <Routes>
                    <Route
                        path="/verify"
                        element={
                            <VerifyEmail
                                unverified
                                onContinue={restore}
                                onSignOut={() => {
                                    discard();
                                }}
                            />
                        }
                    />
                    <Route path="*" element={<Navigate to="/verify" replace />} />
                </Routes>
            ) : failed ? (
                <>
                    <LoadFailed
                        message={failed === "offline" ? strings.sync.offlineExpired : undefined}
                        variant="page"
                        onRetry={() => {
                            retry();
                        }}
                        retrying={loading}
                        actions={
                            <Button variant="quiet" onPress={reauthenticate}>
                                {strings.sync.signInAgain}
                            </Button>
                        }
                    />
                </>
            ) : db ? (
                <PowerSyncContext.Provider value={db}>
                    <BusinessScope onRetry={restore}>
                        {(businessKey) => (
                            <AppRoutes
                                key={businessKey}
                                authed
                                onSignOut={() => {
                                    discard();
                                }}
                                onAuthed={() => {
                                    restore();
                                }}
                            />
                        )}
                    </BusinessScope>
                    {config.dev ? <DebugPanel /> : null}
                </PowerSyncContext.Provider>
            ) : (
                <Routes>
                    <Route
                        path="/accept-invite"
                        element={
                            <AcceptInvite
                                onAuthed={() => {
                                    restore();
                                }}
                            />
                        }
                    />
                    <Route path="/verify" element={<VerifyEmail />} />
                    <Route path="/auth-error" element={<AuthError />} />
                    <Route
                        path="*"
                        element={
                            <Login
                                onSuccess={() => {
                                    restore();
                                }}
                            />
                        }
                    />
                </Routes>
            )}
            <ConfirmHost />
        </BrowserRouter>
    );
}

function AppRoutes({
    authed,
    onSignOut,
    onAuthed,
}: {
    authed: boolean;
    onSignOut: () => void;
    onAuthed: () => void;
}) {
    const business = useBusinessLoad();

    return (
        <BusinessZoneContext.Provider value={business.zone}>
            <Routes>
                <Route
                    path="/accept-invite"
                    element={<AcceptInvite onAuthed={onAuthed} onSignOut={onSignOut} />}
                />
                <Route path="/verify" element={<VerifyEmail />} />
                <Route path="/auth-error" element={<AuthError />} />
                {authed ? (
                    !business.ready ? (
                        <Route
                            path="*"
                            element={
                                business.state === "empty" ? (
                                    <Onboarding onSignOut={onSignOut} />
                                ) : business.state === "error" ? (
                                    <LoadFailed
                                        variant="page"
                                        onRetry={business.retry}
                                        retrying={business.retrying}
                                    />
                                ) : (
                                    <Splash />
                                )
                            }
                        />
                    ) : (
                        <Route element={<AppShell onSignOut={onSignOut} />}>
                            <Route index element={<Navigate to="/today" replace />} />
                            <Route path="today" element={<Today />} />
                            <Route path="schedule" element={<Schedule />} />
                            <Route path="schedule/classes" element={<Classes />} />
                            <Route path="schedule/series" element={<Recurrences />} />
                            <Route path="clients" element={<Clients />} />
                            <Route path="clients/:clientId/:view" element={<Clients />} />
                            <Route path="payments/:tab?" element={<Payments />} />
                            <Route path="inbox" element={<Inbox />} />
                            <Route path="setup/:section?" element={<Setup />} />
                            <Route path="*" element={<Navigate to="/today" replace />} />
                        </Route>
                    )
                ) : (
                    <Route path="*" element={<Login onSuccess={onAuthed} />} />
                )}
            </Routes>
        </BusinessZoneContext.Provider>
    );
}

function Splash() {
    return (
        <div role="status" className="flex min-h-screen flex-col items-center justify-center bg-bg">
            <Logo className="loading-logo h-16 w-auto text-accent" />
            <span className="sr-only">{strings.common.loading}</span>
        </div>
    );
}

function BusinessScope({
    children,
    onRetry,
}: {
    children: (key: string) => ReactNode;
    onRetry: () => void;
}) {
    const business = useBusinessSelection(selectBusiness);
    return (
        <>
            {business.options.length > 1 ? (
                <Select
                    label={strings.business.selectBusiness}
                    placeholder={strings.business.chooseBusiness}
                    options={business.options}
                    value={business.selectedId ?? ""}
                    onChange={business.choose}
                    disabled={business.busy}
                    error={business.error}
                />
            ) : null}
            {business.ready ? (
                children(business.selectedId ?? "onboarding")
            ) : business.error ? (
                <LoadFailed variant="page" onRetry={onRetry} retrying={false} />
            ) : business.needsChoice ? null : (
                <Splash />
            )}
        </>
    );
}
