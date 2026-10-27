import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";

const KEY = "cb_sidebar_collapsed";

/** Whether the tablet sidebar is collapsed to a rail, remembered across launches. */
export function useSidebarToggle(): { collapsed: boolean; toggle: () => void } {
    const [collapsed, setCollapsed] = useState(false);
    useEffect(() => {
        SecureStore.getItemAsync(KEY)
            .then((v) => {
                setCollapsed(v === "1");
            })
            .catch(() => undefined);
    }, []);
    return useMemo(
        () => ({
            collapsed,
            toggle: () => {
                const next = !collapsed;
                setCollapsed(next);
                SecureStore.setItemAsync(KEY, next ? "1" : "0").catch(() => undefined);
            },
        }),
        [collapsed],
    );
}
