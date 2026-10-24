import { describe, expect, it } from "vitest";

import { activePool, resourceName } from "./resources";

const rooms = [
    { id: "rs_1", name: "Room 1", active: 1 },
    { id: "rs_2", name: "Room 2", active: 0 },
    { id: "rs_3", name: "Couples table 1", active: true },
];

describe("resources", () => {
    it("keeps a pool's rooms that are still in service, in pool order", () => {
        expect(activePool(rooms, ["rs_3", "rs_2", "rs_1", "rs_gone"])).toEqual(["rs_3", "rs_1"]);
        expect(activePool(rooms, [])).toEqual([]);
    });

    it("names a room, retired ones included, and nothing for none", () => {
        expect(resourceName(rooms, "rs_2")).toBe("Room 2");
        expect(resourceName(rooms, null)).toBeNull();
        expect(resourceName(rooms, "rs_gone")).toBeNull();
    });
});
