import { useBusinessId } from "@clientbridge/app-core";
import { PowerSyncContext, useStatus } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DebugPanel } from "./components/DebugPanel";
import { Login } from "./components/Login";
import { Logo } from "./components/icons";
import { api, onSignedOut } from "./lib/api";
import { clearTokens, isAuthenticated } from "./lib/auth";
import { connectPowerSync, db, signOut } from "./lib/powersync";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Account } from "./pages/Account";
import { BookingForms } from "./pages/BookingForms";
import { Calendar } from "./pages/Calendar";
import { Catalog } from "./pages/Catalog";
import { Clients } from "./pages/Clients";
import { GiftCards } from "./pages/GiftCards";
import { Inbox } from "./pages/Inbox";
import { Invoices } from "./pages/Invoices";
import { Onboarding } from "./pages/Onboarding";
import { PaymentsSettings } from "./pages/PaymentsSettings";
import { Payouts } from "./pages/Payouts";
import { POS } from "./pages/POS";
import { Reports } from "./pages/Reports";
import { Reviews } from "./pages/Reviews";
import { Scheduling } from "./pages/Scheduling";
import { SettingsLayout } from "./pages/Settings";
import { TaxSettings } from "./pages/TaxSettings";
import { Team } from "./pages/Team";
import { Today } from "./pages/Today";

export function App() {
    const [authed, setAuthed] = useState(isAuthenticated());

    const handleSignOut = useCallback(async (): Promise<void> => {
        clearTokens();
        await signOut();
        setAuthed(false);
    }, []);

    const handleAuthed = useCallback(async (): Promise<void> => {
        // Switching identity while already signed in (accept-invite): the [authed] connect effect
        // won't re-fire (authed stays true), so purge the previous tenant's replica + reconnect here
        // rather than leaving stale rows (and a stale businessId) on the device.
        if (authed) {
            await db.disconnectAndClear();
            await connectPowerSync(api.authFetch);
        }
        setAuthed(true);
    }, [authed]);

    useEffect(() => {
        onSignedOut(() => {
            void handleSignOut();
        });
    }, [handleSignOut]);

    useEffect(() => {
        if (authed) void connectPowerSync(api.authFetch);
    }, [authed]);

    return (
        <PowerSyncContext.Provider value={db}>
            <BrowserRouter>
                <AppRoutes
                    authed={authed}
                    onSignOut={() => void handleSignOut()}
                    onAuthed={() => void handleAuthed()}
                />
            </BrowserRouter>
            {authed && import.meta.env.DEV ? <DebugPanel /> : null}
        </PowerSyncContext.Provider>
    );
}

/** Routes split per session state. Inside PowerSyncContext so it can gate an authed-but-no-business
 *  user (a fresh sign-up) into the onboarding step until their business has synced. */
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
                        <Route index element={<Navigate to="/home" replace />} />
                        <Route path="home" element={<Today />} />
                        <Route path="calendar" element={<Calendar />} />
                        <Route path="clients" element={<Clients />} />
                        <Route path="inbox" element={<Inbox />} />
                        <Route path="invoices" element={<Invoices />} />
                        <Route path="pos" element={<POS />} />
                        <Route path="gift-cards" element={<GiftCards />} />
                        <Route path="payouts" element={<Payouts />} />
                        <Route path="reviews" element={<Reviews />} />
                        <Route path="reports" element={<Reports />} />
                        <Route path="settings" element={<SettingsLayout />}>
                            <Route index element={<Navigate to="/settings/catalog" replace />} />
                            <Route path="account" element={<Account />} />
                            <Route path="catalog" element={<Catalog />} />
                            <Route path="taxes" element={<TaxSettings />} />
                            <Route path="payments" element={<PaymentsSettings />} />
                            <Route path="team" element={<Team />} />
                            <Route path="scheduling" element={<Scheduling />} />
                            <Route path="booking" element={<BookingForms />} />
                        </Route>
                        <Route path="*" element={<Navigate to="/clients" replace />} />
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
            <Logo className="h-8 w-8 animate-pulse text-accent" />
        </div>
    );
}
