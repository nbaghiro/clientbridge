import { AppSchema } from "../src/schema";
import { holdReplicaFile } from "../src/files";
import { ReplicaController } from "../src/lifecycle";
import { browserTabs } from "../src/tabs";
import { PowerSyncDatabase, WASQLiteVFS } from "@powersync/web";
import { Schema, Table, column } from "@powersync/common";

// a project can run the suite on IndexedDB, the storage Chromium and Firefox use today
const storage = (globalThis as { replicaStorage?: string }).replicaStorage;

function replicaOptions(dbFilename: string) {
    const vfs =
        storage === "indexeddb" ? WASQLiteVFS.IDBBatchAtomicVFS : WASQLiteVFS.OPFSCoopSyncVFS;
    return { dbFilename, vfs };
}

export async function openReplica(filename: string) {
    const db = new PowerSyncDatabase({
        schema: AppSchema,
        database: replicaOptions(filename),
    });
    await db.init();
    return db;
}

// Every model column, so any column the service sends is stored where a test can see it.
export async function openModelReplica(filename: string, model: Record<string, string[]>) {
    const db = new PowerSyncDatabase({
        schema: new Schema(
            Object.fromEntries(
                Object.entries(model).map(([table, columns]) => [
                    table,
                    new Table(
                        Object.fromEntries(
                            columns
                                .filter((name) => name !== "id")
                                .map((name) => [name, column.text]),
                        ),
                    ),
                ]),
            ),
        ),
        database: replicaOptions(filename),
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
            users: new Table({
                name: column.text,
                email: column.text,
                phone: column.text,
            }),
        }),
        database: replicaOptions(filename),
    });
    await db.init();
    return db;
}

export { replicaFilename } from "../src/lifecycle";
export { removeReplicaFiles } from "../src/files";

export function replicaDatabase(filename: string) {
    const db = new PowerSyncDatabase({ schema: AppSchema, database: replicaOptions(filename) });
    holdReplicaFile(db, filename);
    return db;
}

// the controller as the web app builds it, with tabs sharing the sync worker where the browser has one
export function replicaController(
    open: (filename: string) => PowerSyncDatabase = replicaDatabase,
    files?: ConstructorParameters<typeof ReplicaController>[1],
) {
    return new ReplicaController(open, files, browserTabs);
}

export const liveReplicas = new Map<string, PowerSyncDatabase>();
export {
    businessQuery,
    keepTabBusiness,
    selectBusinessPerTab,
    selectReplicaBusiness,
    selectionQuery,
} from "../src/scoping";
export { enqueueHours, uploadHoursOnce, discardRejectedQueue } from "../src/hours";
export { subscribeHistory } from "../src/history";

export async function replicaFiles(name: string): Promise<string[]> {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const entry of root.keys()) if (entry.startsWith(name)) names.push(entry);
    return names.sort();
}

export { isStorageFull } from "../../app-core/src/domain/sync";
export { opfsSyncAccess } from "../../../apps/web/src/lib/storage";
export { discardDirectWrites } from "../src/connector";
export { startHoursUploads } from "../src/hours";
