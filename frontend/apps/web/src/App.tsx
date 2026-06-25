import { PowerSyncContext } from "@powersync/react";
import { useEffect } from "react";

import { DebugPanel } from "./components/DebugPanel";
import { Shell } from "./components/Shell";
import { connectPowerSync, db } from "./lib/powersync";

export function App() {
    useEffect(() => {
        // Fire-and-forget: PowerSync streams in the background; local reads work offline immediately.
        void connectPowerSync();
    }, []);

    return (
        <PowerSyncContext.Provider value={db}>
            <Shell />
            <DebugPanel />
        </PowerSyncContext.Provider>
    );
}
