// Typed API client for the FastAPI backend.
// `paths`/`components` come from the generated OpenAPI types (`task gen-api`).
// The write path for synced data goes through PowerSync (@clientbridge/sync); this client is for
// non-synced/RPC calls (auth, public booking, file uploads, reports, admin actions).
export type { paths, components } from "./generated";

export interface ApiClientOptions {
    baseUrl: string;
    getToken?: () => Promise<string>;
}

export function createApi(opts: ApiClientOptions) {
    const headers = async (): Promise<Record<string, string>> => {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        const token = opts.getToken ? await opts.getToken() : "";
        if (token) h.Authorization = `Bearer ${token}`;
        return h;
    };

    return {
        async get<T>(path: string): Promise<T> {
            const res = await fetch(`${opts.baseUrl}${path}`, { headers: await headers() });
            if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
            return (await res.json()) as T;
        },
        async post<T>(path: string, body: unknown): Promise<T> {
            const res = await fetch(`${opts.baseUrl}${path}`, {
                method: "POST",
                headers: await headers(),
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
            return (await res.json()) as T;
        },
        async patch<T>(path: string, body: unknown): Promise<T> {
            const res = await fetch(`${opts.baseUrl}${path}`, {
                method: "PATCH",
                headers: await headers(),
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
            return (await res.json()) as T;
        },
    };
}
