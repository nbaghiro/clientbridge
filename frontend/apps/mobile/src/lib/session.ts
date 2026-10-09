import { strings, useSyncState } from "@clientbridge/app-core";
import { confirm } from "@clientbridge/ui";
import { createContext, useCallback, useContext } from "react";

export const SignOutContext = createContext<() => void>(() => undefined);

/** Signs out, after naming the changes that would be lost when some haven't synced yet. */
export function useSignOut(): () => void {
    const signOut = useContext(SignOutContext);
    const sync = useSyncState();
    return useCallback(() => {
        if (sync.queueKnown && sync.pendingCount === 0) {
            signOut();
            return;
        }
        const t = strings.sync;
        const list = sync.pending.map((p) => `• ${p.label}`).join("\n");
        confirm({
            title: t.signOutTitle,
            message: `${sync.queueKnown ? t.signOutBody(sync.pendingCount) : t.signOutUnknown}\n\n${list}\n\n${t.signOutSafe}`,
            confirmLabel: t.signOutConfirm,
            cancelLabel: t.signOutCancel,
            destructive: true,
        })
            .then((ok) => {
                if (ok) signOut();
            })
            .catch(() => undefined);
    }, [signOut, sync.pendingCount, sync.pending, sync.queueKnown]);
}
