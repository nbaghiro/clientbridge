import type { Load } from "@clientbridge/app-core";
import { LoadFailed, Skeleton } from "@clientbridge/ui";
import type { ReactNode } from "react";

/** Skeleton while the replica loads, a retry when it failed, else the content. */
export function Loaded({
    load,
    loading,
    failed,
    rows = 4,
    children,
}: {
    load: Load;
    loading: string;
    failed: string;
    rows?: number;
    children: ReactNode;
}) {
    if (load.state === "loading") return <Skeleton variant="row" count={rows} label={loading} />;
    if (load.state === "error")
        return <LoadFailed message={failed} onRetry={load.retry} retrying={load.retrying} />;
    return <>{children}</>;
}
