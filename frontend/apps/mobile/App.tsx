// App root: wires the PowerSync database into the React tree and connects on mount.
// op-sqlite is a native module → run via Expo dev build / EAS Build, NOT Expo Go (see .docs/sync.md).
import { PowerSyncContext } from "@powersync/react";
import { useEffect } from "react";

import { connectPowerSync, db } from "./src/lib/powersync";
import { HomeScreen } from "./src/screens/Home";

export function App() {
    useEffect(() => {
        void connectPowerSync();
    }, []);

    return (
        <PowerSyncContext.Provider value={db}>
            <HomeScreen />
        </PowerSyncContext.Provider>
    );
}
