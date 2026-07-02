import { useEffect, useState } from "react";

export type PublicLoadStatus = "loading" | "not-found" | "error" | "ready";

export interface PublicResource<T> {
    status: PublicLoadStatus;
    data: T | null;
    setData: (value: T) => void;
}

function statusOf(err: unknown): number | null {
    if (err !== null && typeof err === "object" && "status" in err) {
        const s = err.status;
        return typeof s === "number" ? s : null;
    }
    return null;
}

/** The load half shared by every public surface: fetch a token/slug-keyed resource once, mapping a
 *  404 → "not-found" and any other failure → "error", with a liveness guard against stale sets.
 *  `load` must be a stable reference — the public fetch clients are built at module scope, so a caller
 *  passes `client.method` directly. Each surface layers its own state + terminal status on top; a
 *  surface that mutates the resource on submit uses `setData`. */
export function usePublicResource<T>(
    load: (token: string) => Promise<T>,
    token: string,
): PublicResource<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let live = true;
        setLoading(true);
        load(token)
            .then((d) => {
                if (live) setData(d);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (statusOf(err) === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [load, token]);

    const status: PublicLoadStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || data === null
            ? "error"
            : "ready";
    return { status, data, setData };
}
