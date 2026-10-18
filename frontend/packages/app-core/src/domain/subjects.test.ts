import { describe, expect, it } from "vitest";

import { zonedDate } from "../datetime";
import { formatParts } from "../format";
import { strings } from "../strings";
import { equipmentLines, leadField, subjectSummary, subjectTemperament } from "./subjects";

const ZONE = "America/Vancouver";
const NOW = zonedDate(2026, 10, 7, 12, 0, ZONE);

const s = strings.subjects;

describe("subjectSummary", () => {
    it("reads each kind's own details and ignores another kind's keys", () => {
        const attributes = {
            breed: "Collie",
            weight_kg: 22,
            birthday: "2020-03-01",
            grade: "Grade 4",
            school: "Oak Bay",
            address: "12 Pine St",
            rooms: 3,
        };
        expect(subjectSummary("pet", attributes, ZONE, NOW)).toBe(
            formatParts(["Collie", s.age(6), s.weight(22)]),
        );
        expect(subjectSummary("student", attributes, ZONE, NOW)).toBe(
            formatParts(["Grade 4", "Oak Bay", s.age(6)]),
        );
        expect(subjectSummary("property", attributes, ZONE, NOW)).toBe(
            formatParts(["12 Pine St", s.rooms(3)]),
        );
        expect(subjectSummary("site", attributes, ZONE, NOW)).toBe("12 Pine St");
        expect(subjectSummary(null, attributes, ZONE, NOW)).toBe("");
    });

    it("counts a birthday later this year as one year younger", () => {
        expect(subjectSummary("student", { birthday: "2016-12-01" }, ZONE, NOW)).toBe(s.age(9));
    });
});

describe("subjectTemperament", () => {
    it("is a pet's alone, and flags the temperaments that need care", () => {
        expect(subjectTemperament("pet", { temperament: "anxious" })).toEqual({
            label: s.fields.pet.temperaments.anxious,
            nervous: true,
        });
        expect(subjectTemperament("pet", { temperament: "calm" })?.nervous).toBe(false);
        expect(subjectTemperament("pet", {})).toBeNull();
        expect(subjectTemperament("property", { temperament: "anxious" })).toBeNull();
    });
});

describe("leadField", () => {
    it("asks a new client's first subject for the detail its kind leads with", () => {
        expect(leadField("pet").key).toBe("breed");
        expect(leadField("student").key).toBe("grade");
        expect(leadField("property").key).toBe("address");
        expect(leadField("site").key).toBe("address");
    });
});

describe("a site", () => {
    const site = {
        address: "880 Douglas St",
        building: "retail",
        equipment: [
            { model: "4MP turret", location: "Front door", warranty_until: "2026-11-01" },
            {
                model: "Recorder",
                serial: "NV-1",
                installed_on: "2024-05-02",
                warranty_until: "2026-01-31",
            },
            { model: "Doorbell", warranty_until: "2029-04-12" },
            { model: "Switch" },
            "not a device",
        ],
    };

    it("sums up its address, building and device count", () => {
        expect(subjectSummary("site", site, ZONE, NOW)).toBe(
            formatParts(["880 Douglas St", s.fields.site.buildings("retail"), s.devices(4)]),
        );
    });

    it("lists each device with its warranty, flagging ended and soon-ending ones", () => {
        const lines = equipmentLines(site, ZONE, NOW);
        expect(lines.map((l) => l.intent)).toEqual(["warning", "danger", "success", "neutral"]);
        expect(lines[0]?.detail).toBe("Front door");
        expect(lines[1]?.detail).toContain(s.equipment.serialShort("NV-1"));
        expect(lines[3]?.warranty).toBeNull();
    });
});
