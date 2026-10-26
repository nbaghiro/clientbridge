import type { Load } from "@clientbridge/app-core";
import { LoadFailed, Panel, Skeleton } from "@clientbridge/ui";
import type { ReactNode } from "react";

/** Skeleton while the replica loads, a retry when it failed, else the content. */
export function Loaded({
    load,
    loading,
    failed,
    rows = 4,
    flush = false,
    children,
}: {
    load: Load;
    loading: string;
    failed: string;
    rows?: number;
    // Inside a list that already has its own frame, the placeholder rows sit bare.
    flush?: boolean;
    children: ReactNode;
}) {
    if (load.state === "loading" && flush)
        return <Skeleton variant="row" count={rows} label={loading} />;
    if (load.state === "loading")
        return (
            <Panel flush>
                <Skeleton variant="row" count={rows} label={loading} />
            </Panel>
        );
    if (load.state === "error")
        return (
            <LoadFailed
                variant={flush ? "inline" : "card"}
                message={failed}
                onRetry={load.retry}
                retrying={load.retrying}
            />
        );
    return <>{children}</>;
}
