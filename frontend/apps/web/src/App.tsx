import type { ReactNode } from "react";
import {
    BusinessZoneContext,
    failedStatus,
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
import { Button, ConfirmHost, LoadFailed, Loading, Logo, Select } from "@clientbridge/ui";
import { api, identity, onSignedOut, selectBusiness } from "./lib/api";
import { clearUser, getUserId, onSessionChanged, rememberUser, sessionExpected } from "./lib/auth";
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

async function signedInUser(): Promise<string | null> {
    if (!sessionExpected()) return null;
    try {
        return (await api.forBusiness(null).get<{ user_id: string }>("/v1/me")).user_id;
    } catch (e) {
        // Offline or Kratos down: the remembered user's replica still opens.
        const status = failedStatus(e);
        if (status === null || status >= 500) return getUserId();
        return null;
    }
}

async function endSession(): Promise<void> {
    await clearUser();
    await identity.signOut().catch(() => undefined);
}

const lifecycle = {
    restore: async (stale: () => boolean) => {
        const userId = await signedInUser();
        // A replaced restore (development runs effects twice) must not touch the replica.
        if (stale()) return null;
        if (userId === null) {
            await replica.pause();
            return null;
        }
        await rememberUser(userId);
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
    const { db, loading, failed, restore, discard, retry, reauthenticate } =
        useReplicaSession(lifecycle);
    return (
        <BrowserRouter>
            {loading ? (
                <Splash />
            ) : failed ? (
                <>
                    <LoadFailed
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
        <div className="flex min-h-screen flex-col items-center justify-center bg-bg">
            <Logo className="h-8 w-auto animate-pulse text-accent" />
            <Loading />
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
                <Loading />
            )}
        </>
    );
}
