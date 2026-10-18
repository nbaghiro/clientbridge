import { describe, expect, it } from "vitest";

import { zonedDate } from "../datetime";
import { formatParts } from "../format";
import { strings } from "../strings";
import { leadField, subjectSummary, subjectTemperament } from "./subjects";

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
    });
});
