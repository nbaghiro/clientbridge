import type { CommonPowerSyncDatabase } from "@powersync/common";

const SUFFIXES = ["", "-journal", "-wal"];

function missing(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
}

function openLock(name: string): string {
    return `replica-open:/${name}`;
}

/** Holds the replica's file against removal for as long as `db` stays open in this tab. */
export function holdReplicaFile(db: CommonPowerSyncDatabase, name: string): void {
    let release = (): void => undefined;
    const closed = new Promise<void>((resolve) => {
        release = resolve;
    });
    const stop = db.registerListener({
        closed: () => {
            stop();
            release();
        },
    });
    navigator.locks
        .request(openLock(name), { mode: "shared" }, () => closed)
        .catch(() => undefined);
}

/** Removes a replica's OPFS files only while no tab has it open; resolves whether they're gone. */
export async function removeReplicaFiles(name: string): Promise<boolean> {
    const root = await navigator.storage.getDirectory();
    // an open replica retakes its access handles after each transaction, recreating a removed file in WebKit
    return navigator.locks.request(openLock(name), { ifAvailable: true }, (open) =>
        open
            ? navigator.locks.request(`ahp:/${name}`, { ifAvailable: true }, async (lock) => {
                  if (!lock) return false;
                  let gone = true;
                  for (const suffix of SUFFIXES) {
                      try {
                          await root.removeEntry(name + suffix);
                      } catch (error) {
                          if (!missing(error)) gone = false;
                      }
                  }
                  return gone;
              })
            : false,
    );
}
