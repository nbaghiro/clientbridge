import { AppSchema, createConnector } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/web";

const backendUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";
const powersyncUrl = import.meta.env.VITE_POWERSYNC_URL ?? "http://localhost:8704";

export const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: "clientbridge.db" },
});

/**
 * Connect to PowerSync. Pass a function returning the app JWT once auth exists; defaults to a dev
 * no-op token (the backend's /sync/token mints a dev-user token when unauthenticated).
 */
export async function connectPowerSync(
    getToken: () => Promise<string> = () => Promise.resolve(""),
): Promise<void> {
    await db.connect(createConnector({ backendUrl, powersyncUrl, getToken }));
}

export { backendUrl, powersyncUrl };
