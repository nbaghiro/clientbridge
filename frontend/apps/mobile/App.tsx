// App root: gates on auth, then wires PowerSync in. op-sqlite is native → run via a dev build.
import { PowerSyncContext } from "@powersync/react";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { getAccessToken, getTokens } from "./src/lib/auth";
import { connectPowerSync, db } from "./src/lib/powersync";
import { HomeScreen } from "./src/screens/Home";
import { LoginScreen } from "./src/screens/Login";

export function App() {
    const [authed, setAuthed] = useState<boolean | null>(null);

    useEffect(() => {
        void getTokens().then((t) => {
            setAuthed(t !== null);
        });
    }, []);

    useEffect(() => {
        if (authed) void connectPowerSync(getAccessToken);
    }, [authed]);

    if (authed === null) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }
    if (!authed) {
        return (
            <LoginScreen
                onSuccess={() => {
                    setAuthed(true);
                }}
            />
        );
    }
    return (
        <PowerSyncContext.Provider value={db}>
            <HomeScreen />
        </PowerSyncContext.Provider>
    );
}
