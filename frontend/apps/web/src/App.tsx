import { PowerSyncContext } from "@powersync/react";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DebugPanel } from "./components/DebugPanel";
import { Login } from "./components/Login";
import { clearTokens, getAccessToken, isAuthenticated } from "./lib/auth";
import { connectPowerSync, db, signOut } from "./lib/powersync";
import { Clients } from "./pages/Clients";
import { Placeholder } from "./pages/Placeholder";

export function App() {
    const [authed, setAuthed] = useState(isAuthenticated());

    useEffect(() => {
        if (authed) void connectPowerSync(() => Promise.resolve(getAccessToken()));
    }, [authed]);

    if (!authed) {
        return (
            <Login
                onSuccess={() => {
                    setAuthed(true);
                }}
            />
        );
    }

    const onSignOut = async (): Promise<void> => {
        clearTokens();
        await signOut();
        setAuthed(false);
    };

    return (
        <PowerSyncContext.Provider value={db}>
            <BrowserRouter>
                <Routes>
                    <Route element={<AppShell onSignOut={() => void onSignOut()} />}>
                        <Route index element={<Navigate to="/clients" replace />} />
                        <Route path="today" element={<Placeholder title="Today" />} />
                        <Route path="calendar" element={<Placeholder title="Calendar" />} />
                        <Route path="clients" element={<Clients />} />
                        <Route path="invoices" element={<Placeholder title="Invoices" />} />
                        <Route path="inbox" element={<Placeholder title="Inbox" />} />
                        <Route path="catalog" element={<Placeholder title="Catalog" />} />
                        <Route path="*" element={<Navigate to="/clients" replace />} />
                    </Route>
                </Routes>
            </BrowserRouter>
            <DebugPanel />
        </PowerSyncContext.Provider>
    );
}
