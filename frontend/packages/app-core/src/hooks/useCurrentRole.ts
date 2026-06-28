import { useQuery } from "@powersync/react";
import { useMemo } from "react";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Streaming base64url → byte string (DOM-free so it also type-checks under the mobile lib set).
function base64UrlDecode(input: string): string {
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const ch of input.replace(/-/g, "+").replace(/_/g, "/")) {
        const idx = B64.indexOf(ch);
        if (idx < 0) continue; // padding / stray chars
        buffer = (buffer << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return out;
}

/** Read the `sub` (user id) claim from an unverified JWT. The value only scopes a local read;
 *  the server still authorizes every write. Returns `null` for a missing/malformed token. */
export function decodeJwtSub(token: string | null): string | null {
    if (token === null) return null;
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    try {
        const claims = JSON.parse(base64UrlDecode(payload)) as { sub?: unknown };
        return typeof claims.sub === "string" ? claims.sub : null;
    } catch {
        return null;
    }
}

/** The current user's role, from the synced `staff` row whose `user_id` matches the access token's
 *  `sub`. `null` until that row syncs (or when signed out / token undecodable). */
export function useCurrentRole(accessToken: string | null): string | null {
    const userId = useMemo(() => decodeJwtSub(accessToken), [accessToken]);
    const rows = useQuery<{ role: string }>(
        "SELECT role FROM staff WHERE user_id = ? AND status = 'active' LIMIT 1",
        [userId],
    ).data;
    return rows[0]?.role ?? null;
}
