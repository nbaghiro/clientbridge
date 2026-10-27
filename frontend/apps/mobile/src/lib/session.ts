import { strings, useSyncState } from "@clientbridge/app-core";
import { confirm } from "@clientbridge/ui";
import { createContext, useCallback, useContext } from "react";

export const SignOutContext = createContext<() => void>(() => undefined);

/** Signs out, after naming the changes that would be lost when some haven't synced yet. */
export function useSignOut(): () => void {
    const signOut = useContext(SignOutContext);
    const { recheck } = useSyncState();
    return useCallback(() => {
        recheck()
            .then((queue) => {
                if (queue?.count === 0) {
                    signOut();
                    return;
                }
                const t = strings.sync;
                const list = (queue?.pending ?? [])
                    .map((p) => strings.common.bullet(p.label))
                    .join("\n");
                const summary = queue === null ? t.signOutUnknown : t.signOutBody(queue.count);
                confirm({
                    title: t.signOutTitle,
                    message: [summary, list, t.signOutSafe].join("\n\n"),
                    confirmLabel: t.signOutConfirm,
                    cancelLabel: t.signOutCancel,
                    destructive: true,
                })
                    .then((ok) => {
                        if (ok) signOut();
                    })
                    .catch(() => undefined);
            })
            .catch(() => undefined);
    }, [signOut, recheck]);
}
