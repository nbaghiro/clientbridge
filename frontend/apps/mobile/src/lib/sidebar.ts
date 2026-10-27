import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";

const KEY = "cb_sidebar_hidden";

/** Whether the tablet sidebar is hidden, remembered across launches. */
export function useSidebarToggle(): { hidden: boolean; toggle: () => void } {
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        SecureStore.getItemAsync(KEY)
            .then((v) => {
                setHidden(v === "1");
            })
            .catch(() => undefined);
    }, []);
    return useMemo(
        () => ({
            hidden,
            toggle: () => {
                const next = !hidden;
                setHidden(next);
                SecureStore.setItemAsync(KEY, next ? "1" : "0").catch(() => undefined);
            },
        }),
        [hidden],
    );
}
