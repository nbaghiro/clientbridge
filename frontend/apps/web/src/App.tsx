import { useBusinessId } from "@clientbridge/app-core";
import { PowerSyncContext, useStatus } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DebugPanel } from "./components/DebugPanel";
import { Login } from "./pages/Login";
import { ConfirmHost, Logo } from "@clientbridge/ui";
import { api, onSignedOut } from "./lib/api";
import { clearTokens, isAuthenticated } from "./lib/auth";
import { connectPowerSync, db, signOut } from "./lib/powersync";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Calendar } from "./pages/Calendar";
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
            {authed && import.meta.env.DEV ? <DebugPanel /> : null}
        </PowerSyncContext.Provider>
    );
}

/** Holds a fresh sign-up in onboarding until their business has synced. */
function AppRoutes({
    authed,
    onSignOut,
    onAuthed,
}: {
    authed: boolean;
    onSignOut: () => void;
    onAuthed: () => void;
}) {
    const hasSynced = useStatus().hasSynced ?? false;
    const businessId = useBusinessId();

    return (
        <Routes>
            {/* The customer surfaces (book/pay/form/contract/review) live in the Connect app. */}
            {/* Public accept-invite page — the emailed token is the credential; success starts a session. */}
            <Route path="/accept-invite" element={<AcceptInvite onAuthed={onAuthed} />} />
            {authed ? (
                businessId === null ? (
                    <Route
                        path="*"
                        element={hasSynced ? <Onboarding onSignOut={onSignOut} /> : <Splash />}
                    />
                ) : (
                    <Route element={<AppShell onSignOut={onSignOut} />}>
                        <Route index element={<Navigate to="/today" replace />} />
                        <Route path="today" element={<Today />} />
                        <Route path="schedule" element={<Calendar />} />
                        <Route path="clients" element={<Clients />} />
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
        <div className="flex min-h-screen items-center justify-center bg-bg">
            <Logo className="h-8 w-auto animate-pulse text-accent" />
        </div>
    );
}
