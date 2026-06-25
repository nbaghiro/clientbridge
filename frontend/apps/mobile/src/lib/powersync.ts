import { AppSchema, createConnector } from "@clientbridge/sync";
import { OPSqliteOpenFactory } from "@powersync/op-sqlite";
import { PowerSyncDatabase } from "@powersync/react-native";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; powersyncUrl?: string };
const backendUrl = extra.apiUrl ?? "http://localhost:8701";
const powersyncUrl = extra.powersyncUrl ?? "http://localhost:8704";

export const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: new OPSqliteOpenFactory({ dbFilename: "clientbridge.db" }),
});

/**
 * Connect to PowerSync. Pass a function returning the app JWT once auth exists; defaults to a
 * dev no-op token (the backend's /sync/token mints a dev-user token when unauthenticated).
 */
export async function connectPowerSync(
    getToken: () => Promise<string> = () => Promise.resolve(""),
): Promise<void> {
    await db.connect(createConnector({ backendUrl, powersyncUrl, getToken }));
}
