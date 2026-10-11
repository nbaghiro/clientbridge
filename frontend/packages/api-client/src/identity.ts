export type FlowKind = "login" | "registration" | "recovery" | "verification" | "settings";

export interface FlowMessage {
    id: number;
    type: string;
    text: string;
}

export interface FlowNode {
    group: string;
    name: string;
    kind: string;
    type?: string;
    value: unknown;
    src?: string;
    text?: string;
    label?: string;
    context?: Record<string, unknown>;
    messages: FlowMessage[];
}

export interface Flow {
    id: string;
    kind: FlowKind;
    state: string | null;
    messages: FlowMessage[];
    nodes: FlowNode[];
    exchangeCode?: string;
}

export type FlowStep =
    | {
          kind: "done";
          sessionToken?: string;
          next?: { flow: "verification" | "settings"; id: string };
      }
    | { kind: "flow"; flow: Flow }
    | { kind: "redirect"; url: string }
    | { kind: "reauth" }
    | { kind: "restart" };

type SessionState = "active" | "aal2" | "none";

interface StartOptions {
    aal?: "aal2" | undefined;
    refresh?: boolean | undefined;
    returnTo?: string | undefined;
    sessionToken?: string | undefined;
}

export interface IdentityClient {
    start(kind: FlowKind, opts?: StartOptions): Promise<Flow>;
    resume(kind: FlowKind, id: string, sessionToken?: string): Promise<Flow>;
    submit(flow: Flow, body: Record<string, unknown>, sessionToken?: string): Promise<FlowStep>;
    session(sessionToken?: string): Promise<SessionState>;
    exchange(flow: Flow, returnToCode: string): Promise<string>;
    signOut(sessionToken?: string): Promise<void>;
}

interface IdentityOptions {
    kratosUrl: string;
    mode: "browser" | "native";
    sessionToken?: () => Promise<string | null>;
    nativeReturnTo?: string;
}

/** Read like an API refusal: app-core takes `status` and `code` ("session_already_available"). */
class IdentityError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
    ) {
        super(`identity ${code} (${String(status)})`);
    }
}

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
    typeof value === "object" && value !== null ? (value as Json) : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function messages(value: unknown): FlowMessage[] {
    return (Array.isArray(value) ? value : []).map((m) => {
        const message = record(m);
        return {
            id: typeof message.id === "number" ? message.id : 0,
            type: text(message.type),
            text: text(message.text),
        };
    });
}

function optional<K extends string>(key: K, value: string): Partial<Record<K, string>> {
    return value ? ({ [key]: value } as Partial<Record<K, string>>) : {};
}

function parseNode(value: unknown): FlowNode {
    const node = record(value);
    const attributes = record(node.attributes);
    const nested = record(attributes.text);
    const label = record(record(node.meta).label);
    const context = { ...record(label.context), ...record(nested.context) };
    return {
        group: text(node.group),
        name: text(attributes.name) || text(attributes.id),
        kind: text(node.type),
        value: attributes.value,
        messages: messages(node.messages),
        ...optional("type", text(attributes.type)),
        ...optional("src", text(attributes.src)),
        ...optional("text", text(nested.text)),
        ...optional("label", text(label.text)),
        ...(Object.keys(context).length ? { context } : {}),
    };
}

export function parseFlow(kind: FlowKind, value: unknown): Flow {
    const flow = record(value);
    const ui = record(flow.ui);
    const exchange = text(flow.session_token_exchange_code);
    return {
        id: text(flow.id),
        kind,
        state: text(flow.state) || null,
        messages: messages(ui.messages),
        nodes: (Array.isArray(ui.nodes) ? ui.nodes : []).map(parseNode),
        ...(exchange ? { exchangeCode: exchange } : {}),
    };
}

function nextStep(continueWith: unknown): {
    sessionToken?: string;
    next?: { flow: "verification" | "settings"; id: string };
} {
    let sessionToken: string | undefined;
    let next: { flow: "verification" | "settings"; id: string } | undefined;
    for (const item of Array.isArray(continueWith) ? continueWith : []) {
        const entry = record(item);
        const id = text(record(entry.flow).id);
        if (entry.action === "set_ory_session_token") sessionToken = text(entry.ory_session_token);
        if (entry.action === "show_settings_ui" && id) next = { flow: "settings", id };
        if (entry.action === "show_verification_ui" && id && !next)
            next = { flow: "verification", id };
    }
    return { ...(sessionToken ? { sessionToken } : {}), ...(next ? { next } : {}) };
}

function errorId(body: Json): string {
    return text(record(body.error).id);
}

/** Drives Kratos self-service flows: browser flows ride the session cookie, native flows a token. */
export function createIdentityClient(opts: IdentityOptions): IdentityClient {
    const base = opts.kratosUrl.replace(/\/+$/, "");
    const browser = opts.mode === "browser";

    const request = async (
        path: string,
        init: RequestInit = {},
        sessionToken?: string,
    ): Promise<Response> => {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/json");
        if (!browser) {
            const token = sessionToken ?? (await opts.sessionToken?.());
            if (token) headers.set("X-Session-Token", token);
        }
        return fetch(`${base}${path}`, {
            ...init,
            headers,
            ...(browser ? { credentials: "include" as const } : {}),
        });
    };

    const body = async (res: Response): Promise<Json> => record(await res.json().catch(() => ({})));

    const loaded = async (kind: FlowKind, res: Response): Promise<Flow> => {
        const json = await body(res);
        if (!res.ok) throw new IdentityError(res.status, errorId(json) || "flow_unavailable");
        return parseFlow(kind, json);
    };

    return {
        async start(kind, startOpts = {}) {
            const query = new URLSearchParams();
            if (startOpts.aal) query.set("aal", startOpts.aal);
            if (startOpts.refresh) query.set("refresh", "true");
            if (startOpts.returnTo) query.set("return_to", startOpts.returnTo);
            if (!browser && kind === "login" && opts.nativeReturnTo && !startOpts.aal) {
                query.set("return_session_token_exchange_code", "true");
                query.set("return_to", opts.nativeReturnTo);
            }
            const suffix = query.size ? `?${query.toString()}` : "";
            return loaded(
                kind,
                await request(
                    `/self-service/${kind}/${browser ? "browser" : "api"}${suffix}`,
                    {},
                    startOpts.sessionToken,
                ),
            );
        },

        async resume(kind, id, sessionToken) {
            return loaded(
                kind,
                await request(
                    `/self-service/${kind}/flows?id=${encodeURIComponent(id)}`,
                    {},
                    sessionToken,
                ),
            );
        },

        async submit(flow, values, sessionToken) {
            const csrf = flow.nodes.find((n) => n.name === "csrf_token")?.value;
            const res = await request(
                `/self-service/${flow.kind}?flow=${encodeURIComponent(flow.id)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        browser && typeof csrf === "string"
                            ? { ...values, csrf_token: csrf }
                            : values,
                    ),
                },
                sessionToken,
            );
            const json = await body(res);
            const redirect = text(json.redirect_browser_to);
            const error = errorId(json);
            if (res.status === 422 && redirect) return { kind: "redirect", url: redirect };
            if (error === "session_refresh_required" || res.status === 401)
                return { kind: "reauth" };
            if (
                res.status === 410 ||
                error === "security_csrf_violation" ||
                error === "self_service_flow_expired"
            )
                return { kind: "restart" };
            if (!res.ok && res.status !== 400)
                throw new IdentityError(res.status, error || "submit_failed");
            if ("session" in json) {
                const step = nextStep(json.continue_with);
                const token = text(json.session_token) || step.sessionToken;
                return { kind: "done", ...step, ...(token ? { sessionToken: token } : {}) };
            }
            const step = nextStep(json.continue_with);
            if (step.next?.flow === "settings") return { kind: "done", ...step };
            return { kind: "flow", flow: parseFlow(flow.kind, json) };
        },

        async session(sessionToken) {
            const res = await request("/sessions/whoami", {}, sessionToken);
            if (res.ok) return "active";
            const json = await body(res);
            if (res.status === 403 && errorId(json) === "session_aal2_required") return "aal2";
            if (res.status === 401 || res.status === 403) return "none";
            throw new IdentityError(res.status, errorId(json) || "identity_unavailable");
        },

        async exchange(flow, returnToCode) {
            const query = new URLSearchParams({
                init_code: flow.exchangeCode ?? "",
                return_to_code: returnToCode,
            });
            const json = await body(await request(`/sessions/token-exchange?${query.toString()}`));
            const token = text(json.session_token);
            if (!token) throw new IdentityError(400, errorId(json) || "exchange_failed");
            return token;
        },

        async signOut(sessionToken) {
            if (!browser) {
                const token = sessionToken ?? (await opts.sessionToken?.());
                if (!token) return;
                await request("/self-service/logout/api", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_token: token }),
                });
                return;
            }
            const res = await request("/self-service/logout/browser");
            if (!res.ok) return;
            const token = text((await body(res)).logout_token);
            if (token) await request(`/self-service/logout?token=${encodeURIComponent(token)}`);
        },
    };
}
