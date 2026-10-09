import { type Session, sessionSubject } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/web";
import { beforeSessionReplace, getTokens } from "./auth";
import { config } from "../config";

const { apiUrl, powersyncUrl } = config;

export const replica = new ReplicaController(
    (dbFilename) =>
        new PowerSyncDatabase({
            schema: AppSchema,
            database: { dbFilename },
        }),
);

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const userId = sessionSubject(getTokens()?.access_token);
    if (!userId) throw new Error("a valid account identity is required");
    return replica.activate(
        { userId, apiUrl, powersyncUrl },
        createConnector({ powersyncUrl, authFetch: api.forBusiness(null).authFetchFor(userId) }),
    );
}

export function signOut(): Promise<void> {
    return replica.discard();
}

export { powersyncUrl };
