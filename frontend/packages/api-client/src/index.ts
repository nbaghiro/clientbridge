// Typed API client for the FastAPI backend.
// `paths`/`components` come from the generated OpenAPI types (`task gen-api`).
// The write path for synced data goes through PowerSync (@clientbridge/sync); this client is for
// non-synced/RPC calls (auth, public booking, file uploads, reports, admin actions).
export type { paths, components } from "./generated";
export * from "./session";
