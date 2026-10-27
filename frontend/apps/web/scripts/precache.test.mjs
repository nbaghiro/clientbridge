import assert from "node:assert/strict";
import test from "node:test";

import { precacheAssets } from "./precache.ts";

const build = [
    "index.html",
    "assets/index-C0hN_Vn1.js",
    "assets/index-C0hN_Vn1.js.map",
    "assets/wa-sqlite-CePoIZt_.wasm",
    "assets/wa-sqlite-C_Ay6uXc.js",
    "assets/wa-sqlite-async-B3FiUnt1.wasm",
    "assets/wa-sqlite-async-BKSTLpyq.js",
    "assets/mc-wa-sqlite-Cq3AePIW.wasm",
    "assets/mc-wa-sqlite-D62LTxnz.js",
    "assets/mc-wa-sqlite-async-aRcIGeKj.wasm",
    "assets/mc-wa-sqlite-async-B4qx1Gwb.js",
    "assets/OPFSCoopSyncVFS-DKvy5Ya3.js",
    "assets/IDBBatchAtomicVFS-Cs-q6aUL.js",
    "assets/MemoryVFS-D5PPW9P-.js",
    "assets/AccessHandlePoolVFS-BN1ApLdO.js",
    "assets/OPFSWriteAheadVFS-WPMApnhK.js",
];

test("the shell precaches the builds and VFSs the app loads, once each", () => {
    assert.deepEqual(precacheAssets(build), [
        "/index.html",
        "/assets/index-C0hN_Vn1.js",
        "/assets/wa-sqlite-CePoIZt_.wasm",
        "/assets/wa-sqlite-C_Ay6uXc.js",
        "/assets/wa-sqlite-async-B3FiUnt1.wasm",
        "/assets/wa-sqlite-async-BKSTLpyq.js",
        "/assets/OPFSCoopSyncVFS-DKvy5Ya3.js",
        "/assets/IDBBatchAtomicVFS-Cs-q6aUL.js",
        "/assets/MemoryVFS-D5PPW9P-.js",
    ]);
});

test("the encryption builds and the unused VFSs are left to the network", () => {
    const cached = precacheAssets(build);
    for (const file of [
        "/assets/mc-wa-sqlite-Cq3AePIW.wasm",
        "/assets/mc-wa-sqlite-D62LTxnz.js",
        "/assets/mc-wa-sqlite-async-aRcIGeKj.wasm",
        "/assets/mc-wa-sqlite-async-B4qx1Gwb.js",
        "/assets/AccessHandlePoolVFS-BN1ApLdO.js",
        "/assets/OPFSWriteAheadVFS-WPMApnhK.js",
        "/assets/index-C0hN_Vn1.js.map",
    ])
        assert.ok(!cached.includes(file), file);
});
