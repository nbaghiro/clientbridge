import { useEffect, useState } from "react";

type PublicLoadStatus = "loading" | "not-found" | "error" | "ready";

interface PublicResource<T> {
    status: PublicLoadStatus;
    data: T | null;
    setData: (value: T) => void;
    retry: () => void;
}

function statusOf(err: unknown): number | null {
    if (err !== null && typeof err === "object" && "status" in err) {
        const s = err.status;
        return typeof s === "number" ? s : null;
    }
    return null;
}

/** `load` must be stable (the public clients are built at module scope); 404 maps to "not-found". */
export function usePublicResource<T>(
    load: (token: string) => Promise<T>,
    token: string,
): PublicResource<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setLoadError(false);
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
    }, [load, token, attempt]);

    const status: PublicLoadStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || data === null
            ? "error"
            : "ready";
    return {
        status,
        data,
        setData,
        retry: () => {
            setAttempt((n) => n + 1);
        },
    };
}

/** Pre-validated by the server: `primary` is a hex colour and `logo_url` an http(s) URL. */
export interface PublicBrand {
    logo_url: string | null;
    primary: string | null;
    tagline: string | null;
}
