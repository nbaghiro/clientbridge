import { AppSchema } from "../src/schema";
import { PowerSyncDatabase } from "@powersync/web";
import { Schema, Table, column } from "@powersync/common";

export async function openDatabase(filename: string) {
    const db = new PowerSyncDatabase({
        schema: new Schema({
            hours: new Table({ note: column.text }),
            identities: new Table({ operation: column.text }, { localOnly: true }),
        }),
        database: { dbFilename: filename },
    });
    await db.init();
    return db;
}

export async function openReplica(filename: string) {
    const db = new PowerSyncDatabase({
        schema: AppSchema,
        database: { dbFilename: filename },
    });
    await db.init();
    return db;
}

// Include forbidden columns deliberately: detect server leaks even when the production schema hides them.
export async function openAuthorizationReplica(filename: string) {
    const db = new PowerSyncDatabase({
        schema: new Schema({
            businesses: new Table({ gst_hst_number: column.text }),
            staff: new Table({
                business_id: column.text,
                rate_cents: column.integer,
                invite_token: column.text,
            }),
            clients: new Table({ business_id: column.text, stripe_customer_id: column.text }),
            hours: new Table({ business_id: column.text }),
        }),
        database: { dbFilename: filename },
    });
    await db.init();
    return db;
}

export { ReplicaController } from "../src/lifecycle";

export function replicaDatabase(filename: string) {
    return new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: filename } });
}

export const liveReplicas = new Map<string, PowerSyncDatabase>();
export { businessQuery, selectReplicaBusiness } from "../src/scoping";
export { enqueueHours, uploadHoursOnce } from "../src/hours";
