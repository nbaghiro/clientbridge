import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/react-native";
import { beforeSessionReplace, getSession } from "./auth";
import { apiUrl, powersyncUrl } from "./config";

export const replica = new ReplicaController(
    (dbFilename) =>
        new PowerSyncDatabase({
            schema: AppSchema,
            database: { dbFilename },
        }),
);

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const userId = (await getSession())?.user_id;
    if (!userId) throw new Error("a valid account identity is required");
    return replica.activate(
        { userId, apiUrl, powersyncUrl },
        createConnector({ powersyncUrl, authFetch: api.forBusiness(null).authFetchFor(userId) }),
    );
}

export function signOut(): Promise<void> {
    return replica.discard();
}
