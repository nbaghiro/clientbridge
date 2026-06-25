import { AppSchema, createConnector } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/web";

const backendUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";
const powersyncUrl = import.meta.env.VITE_POWERSYNC_URL ?? "http://localhost:8704";

export const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: "clientbridge.db" },
});

/** Call after login with a function that returns the current app JWT. */
export async function connectPowerSync(getToken: () => Promise<string>): Promise<void> {
    await db.connect(createConnector({ backendUrl, powersyncUrl, getToken }));
}
