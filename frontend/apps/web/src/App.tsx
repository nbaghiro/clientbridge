import type { ReactNode } from "react";
import {
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
import { Login } from "./pages/Login";
import { Button, ConfirmHost, LoadFailed, Loading, Logo, Select } from "@clientbridge/ui";
import { api, onSignedOut, selectBusiness } from "./lib/api";
import { clearTokens, isAuthenticated, onSessionChanged } from "./lib/auth";
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

const lifecycle = {
    restore: async () => {
        if (isAuthenticated()) return connectPowerSync(api);
        await replica.pause();
        return null;
    },
    pause: () => replica.pause(),
    discard: async () => {
        await clearTokens();
        await signOut();
    },
    subscribe: onSignedOut,
    clearCredentials: clearTokens,
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
        <Routes>
            <Route path="/accept-invite" element={<AcceptInvite onAuthed={onAuthed} />} />
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
