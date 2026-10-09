export function sessionSubject(accessToken: string | undefined): string | null {
    const payload = accessToken?.split(".")[1];
    if (!payload) return null;
    try {
        const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        if (typeof decoded !== "object" || decoded === null || !("sub" in decoded)) return null;
        return typeof decoded.sub === "string" && decoded.sub.length > 0 ? decoded.sub : null;
    } catch {
        return null;
    }
}

export function sessionIdentity(accessToken: string | undefined): string | null {
    const subject = sessionSubject(accessToken);
    const payload = accessToken?.split(".")[1];
    if (!subject || !payload) return null;
    try {
        const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
            sid?: unknown;
        };
        if (typeof claims.sid !== "string" || !claims.sid) return null;
        return JSON.stringify([subject, claims.sid]);
    } catch {
        return null;
    }
}
