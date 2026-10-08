import { useBusinessLoad } from "@clientbridge/app-core";
import { PowerSyncContext } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DebugPanel } from "./components/DebugPanel";
import { config } from "./config";
import { Login } from "./pages/Login";
import { ConfirmHost, LoadFailed, Loading, Logo } from "@clientbridge/ui";
import { api, onSignedOut } from "./lib/api";
import { clearTokens, isAuthenticated } from "./lib/auth";
import { connectPowerSync, db, signOut } from "./lib/powersync";
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

export function App() {
    const [authed, setAuthed] = useState(isAuthenticated());

    const handleSignOut = useCallback(async (): Promise<void> => {
        clearTokens();
        await signOut();
        setAuthed(false);
    }, []);

    const handleAuthed = useCallback(async (): Promise<void> => {
        // Already signed in, the connect effect won't re-fire, so drop the old replica and reconnect here.
        if (authed) {
            await db.disconnectAndClear();
            await connectPowerSync(api.authFetch);
        }
        setAuthed(true);
    }, [authed]);

    useEffect(() => {
        onSignedOut(() => {
            handleSignOut().catch(() => undefined);
        });
    }, [handleSignOut]);

    useEffect(() => {
        if (authed) connectPowerSync(api.authFetch).catch(() => undefined);
    }, [authed]);

    return (
        <PowerSyncContext.Provider value={db}>
            <BrowserRouter>
                <AppRoutes
                    authed={authed}
                    onSignOut={() => {
                        handleSignOut().catch(() => undefined);
                    }}
                    onAuthed={() => {
                        handleAuthed().catch(() => undefined);
                    }}
                />
            </BrowserRouter>
            <ConfirmHost />
            {authed && config.dev ? <DebugPanel /> : null}
        </PowerSyncContext.Provider>
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
                                <LoadFailed onRetry={business.retry} retrying={business.retrying} />
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
