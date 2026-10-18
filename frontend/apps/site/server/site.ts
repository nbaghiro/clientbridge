// Serves the waitlist build on Render; the full deploy serves the site from the web image instead.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

// "already" is an address the waitlist holds, which is thanked again and not added twice
export type Joined = "added" | "already" | "failed";
export type JoinWaitlist = (email: string) => Promise<Joined>;
export type ConfirmWaitlist = (email: string, joined: "added" | "already") => Promise<void>;

interface WaitlistEmail {
    subject: string;
    text: string;
    html: string;
}

/** Written by `make gen-waitlist-email` from the backend's email layout and catalog. */
export interface WaitlistEmails {
    joined: WaitlistEmail;
    already: WaitlistEmail;
}

export interface ContactMessage {
    name: string;
    email: string;
    message: string;
}
export type SendContact = (message: ContactMessage) => Promise<void>;

interface SiteOptions {
    dist: string;
    siteUrl: string;
    join: JoinWaitlist;
    confirm?: ConfirmWaitlist;
    contact?: SendContact;
    /** Sign-ups one address may send per window before it gets the retry page. */
    perAddress?: number;
    /** Sign-ups the whole site takes per window, which caps what a flood can cost. */
    total?: number;
    windowMs?: number;
    now?: () => number;
}

const TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

// the same headers the web image's Caddy sends for the site, so moving the site there changes nothing
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// room for a contact message of 5,000 characters, url-encoded
const MAX_BODY = 32_768;

const cacheFor = (path: string): string =>
    path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";

/** The client's address as Render's proxy reports it: the first X-Forwarded-For entry. */
const clientAddress = (req: IncomingMessage): string => {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    return first !== undefined && first !== "" ? first : (req.socket.remoteAddress ?? "unknown");
};

const readBody = (req: IncomingMessage): Promise<string | null> =>
    new Promise((resolve) => {
        let size = 0;
        const chunks: Buffer[] = [];
        // an oversized body is drained rather than cut off, so the visitor still gets the retry page
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= MAX_BODY) chunks.push(chunk);
        });
        req.on("end", () => {
            resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", () => {
            resolve(null);
        });
    });

const redirect = (res: ServerResponse, location: string): void => {
    res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
    res.end();
};

export function createSite(options: SiteOptions): Server {
    const { dist } = options;
    const perAddress = options.perAddress ?? 5;
    const total = options.total ?? 300;
    const windowMs = options.windowMs ?? 60 * 60 * 1000;
    const now = options.now ?? Date.now;
    let windowStart = now();
    let windowTotal = 0;
    const byAddress = new Map<string, number>();

    const allow = (address: string): boolean => {
        if (now() - windowStart >= windowMs) {
            windowStart = now();
            windowTotal = 0;
            byAddress.clear();
        }
        const count = byAddress.get(address) ?? 0;
        if (count >= perAddress || windowTotal >= total) return false;
        byAddress.set(address, count + 1);
        windowTotal += 1;
        return true;
    };

    /** The file a path serves: "/" and "/pricing" are pages, "/assets/x.css" is a file. */
    const fileFor = async (path: string): Promise<string | null> => {
        const clean = path.replace(/\/+$/, "") || "/";
        const relative = extname(clean) ? clean : join(clean, "index.html");
        const file = normalize(join(dist, relative));
        if (!file.startsWith(dist + sep)) return null;
        try {
            return (await stat(file)).isFile() ? file : null;
        } catch {
            return null;
        }
    };

    const send = async (req: IncomingMessage, res: ServerResponse, path: string) => {
        const file = await fileFor(path);
        const served = file ?? join(dist, "404.html");
        const size = (await stat(served)).size;
        res.writeHead(file === null ? 404 : 200, {
            "Content-Type": TYPES[extname(served)] ?? "application/octet-stream",
            "Content-Length": size,
            "Cache-Control": file === null ? "no-cache" : cacheFor(served.slice(dist.length)),
        });
        if (req.method === "HEAD") res.end();
        else createReadStream(served).pipe(res);
    };

    /** A posted form, or null for a body that is too large or not a form. */
    const formOf = async (req: IncomingMessage): Promise<URLSearchParams | null> => {
        const type = req.headers["content-type"] ?? "";
        const body = type.startsWith("application/x-www-form-urlencoded")
            ? await readBody(req)
            : null;
        return body === null ? null : new URLSearchParams(body);
    };

    const contact = async (req: IncomingMessage, res: ServerResponse) => {
        const form = await formOf(req);
        if (form === null) {
            redirect(res, "/contact/retry");
            return;
        }
        if (form.get("website")) {
            redirect(res, "/contact/thanks");
            return;
        }
        const name = (form.get("name") ?? "").trim();
        const email = (form.get("email") ?? "").trim();
        const message = (form.get("message") ?? "").trim();
        const valid =
            name.length > 0 &&
            name.length <= 100 &&
            email.length <= 254 &&
            EMAIL.test(email) &&
            message.length > 0 &&
            message.length <= 5000;
        if (!valid || !options.contact || !allow(clientAddress(req))) {
            redirect(res, "/contact/retry");
            return;
        }
        try {
            await options.contact({ name, email, message });
        } catch (error) {
            process.stderr.write(`contact: sending failed: ${String(error)}\n`);
            redirect(res, "/contact/retry");
            return;
        }
        redirect(res, "/contact/thanks");
    };

    const signUp = async (req: IncomingMessage, res: ServerResponse) => {
        const form = await formOf(req);
        if (form === null) {
            redirect(res, "/waitlist/retry");
            return;
        }
        // a bot that fills the hidden field is thanked and dropped
        if (form.get("website")) {
            redirect(res, "/waitlist/thanks");
            return;
        }
        const email = (form.get("email") ?? "").trim();
        if (email.length > 254 || !EMAIL.test(email) || !allow(clientAddress(req))) {
            redirect(res, "/waitlist/retry");
            return;
        }
        let joined: Joined = "failed";
        try {
            joined = await options.join(email);
        } catch (error) {
            process.stderr.write(`waitlist: sign-up failed: ${String(error)}\n`);
        }
        if (joined !== "failed" && options.confirm) {
            // the sign-up stands even when the confirmation cannot be sent
            await options.confirm(email, joined).catch((error: unknown) => {
                process.stderr.write(`waitlist: confirmation failed: ${String(error)}\n`);
            });
        }
        redirect(res, joined === "failed" ? "/waitlist/retry" : "/waitlist/thanks");
    };

    const handle = async (req: IncomingMessage, res: ServerResponse) => {
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
        let path: string;
        try {
            path = decodeURIComponent(new URL(req.url ?? "/", "http://site").pathname);
        } catch {
            res.writeHead(400).end();
            return;
        }
        if (path === "/robots.txt" && (req.method === "GET" || req.method === "HEAD")) {
            // written here as the web image's Caddy writes it in production, not taken from the build
            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache",
            });
            res.end(
                req.method === "HEAD"
                    ? undefined
                    : `User-agent: *\nAllow: /\n\nSitemap: ${options.siteUrl}/sitemap.xml\n`,
            );
        } else if (path === "/health") {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("ok");
        } else if (path === "/contact" && req.method === "POST") {
            await contact(req, res);
        } else if (path === "/waitlist" && req.method === "POST") {
            await signUp(req, res);
        } else if (req.method === "GET" || req.method === "HEAD") {
            await send(req, res, path);
        } else {
            res.writeHead(405, { Allow: "GET, HEAD" }).end();
        }
    };

    const server = createServer((req, res) => {
        handle(req, res).catch((error: unknown) => {
            process.stderr.write(`site: request failed: ${String(error)}\n`);
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
    });
    server.requestTimeout = 15_000;
    return server;
}

const RESEND = "https://api.resend.com";

const resendFailed = async (step: string, res: Response): Promise<Joined> => {
    const detail = (await res.text()).slice(0, 300);
    process.stderr.write(`waitlist: Resend ${step} answered ${String(res.status)}: ${detail}\n`);
    return "failed";
};

/** Adds the address to the Resend segment the waitlist lives in, unless it is there already. */
export const resendWaitlist =
    (apiKey: string, segmentId: string): JoinWaitlist =>
    async (email) => {
        const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
        const contact = `${RESEND}/contacts/${encodeURIComponent(email)}`;
        const timeout = () => AbortSignal.timeout(10_000);
        const segments = await fetch(`${contact}/segments`, { headers, signal: timeout() });
        if (segments.ok) {
            const listed = (await segments.json()) as { data?: { id: string }[] };
            if (listed.data?.some((segment) => segment.id === segmentId)) return "already";
            const added = await fetch(`${contact}/segments/${segmentId}`, {
                method: "POST",
                headers,
                signal: timeout(),
            });
            return added.ok ? "added" : resendFailed("adding to the segment", added);
        }
        if (segments.status !== 404) return resendFailed("reading segments", segments);
        const created = await fetch(`${RESEND}/contacts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ email, unsubscribed: false, segments: [{ id: segmentId }] }),
            signal: timeout(),
        });
        return created.ok ? "added" : resendFailed("creating the contact", created);
    };

/** Sends the welcome or the already-on-the-list email; the key stops a repeat within a day. */
export const resendConfirmation =
    (apiKey: string, from: string, mails: WaitlistEmails): ConfirmWaitlist =>
    async (email, joined) => {
        const hash = createHash("sha256").update(email.toLowerCase()).digest("hex");
        const sent = await fetch(`${RESEND}/emails`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Idempotency-Key": `waitlist-${joined}-${hash}`,
            },
            body: JSON.stringify({
                from,
                to: [email],
                ...mails[joined === "added" ? "joined" : "already"],
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!sent.ok) throw new Error(`Resend answered ${String(sent.status)}`);
    };

export const apiContact =
    (apiUrl: string): SendContact =>
    async (form) => {
        const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/contact`, {
            method: "POST",
            body: new URLSearchParams({ ...form }),
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
        });
        if (response.status !== 303 || response.headers.get("location") !== "/contact/thanks")
            throw new Error("contact request failed");
    };
