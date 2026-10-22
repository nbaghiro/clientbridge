// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { zonedDate } from "../datetime";
import { formatList, formatParts } from "../format";
import { strings } from "../strings";
import {
    PICKUP_PEOPLE_MAX,
    equipmentLines,
    leadField,
    pickupLine,
    subjectAlerts,
    subjectSummary,
    subjectTemperament,
    useSubjectForm,
} from "./subjects";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: [{ subject: "student" }] }),
}));

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

describe("a student's pickups", () => {
    const attributes = {
        pickups: [
            { name: "Ngozi Nwosu", relation: "Grandmother" },
            { name: " " },
            { name: "Tobi Adeyemi" },
            "not a person",
        ],
        no_pickup: "Not to be released to Kevin Byrne.",
    };

    it("names who may collect them as one list", () => {
        expect(pickupLine("student", attributes)).toBe(
            s.pickup.mayBePickedUpBy(formatList(["Ngozi Nwosu", "Tobi Adeyemi"])),
        );
        expect(pickupLine("student", {})).toBeNull();
        expect(pickupLine("pet", attributes)).toBeNull();
    });

    it("raises a restriction as an alert for students only", () => {
        expect(subjectAlerts("student", attributes, NOW, ZONE)).toEqual([
            {
                key: "noPickup",
                label: s.noPickupAlert("Not to be released to Kevin Byrne."),
                intent: "danger",
            },
        ]);
        expect(subjectAlerts("student", { no_pickup: "  " }, NOW, ZONE)).toEqual([]);
        expect(subjectAlerts("site", attributes, NOW, ZONE)).toEqual([]);
    });
});

function recordingApi(): ApiLike & { sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        sent,
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>(_path: string, body?: unknown) => {
            sent.push(body);
            return Promise.resolve({} as T);
        },
        patch: <T>(_path: string, body?: unknown) => {
            sent.push(body);
            return Promise.resolve({} as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
}

const student = {
    id: "sj_mia",
    clientId: "cl_ann",
    name: "Mia",
    attributes: { grade: "Grade 4", pickups: [{ name: "Rosa Lindqvist", relation: "Aunt" }] },
};

describe("the pickup editor", () => {
    it("starts from the stored list, edits, adds and removes people", () => {
        const { result } = renderHook(() =>
            useSubjectForm(recordingApi(), "cl_ann", student, vi.fn()),
        );
        expect(result.current.pickups).toEqual([
            { name: "Rosa Lindqvist", relation: "Aunt", phone: "", note: "" },
        ]);
        act(() => {
            result.current.addPickup();
        });
        act(() => {
            result.current.setPickup(1, "name", "Ngozi Nwosu");
        });
        expect(result.current.pickups?.map((p) => p.name)).toEqual([
            "Rosa Lindqvist",
            "Ngozi Nwosu",
        ]);
        act(() => {
            result.current.removePickup(0);
        });
        expect(result.current.pickups?.map((p) => p.name)).toEqual(["Ngozi Nwosu"]);
    });

    it("stops at the API's limit", () => {
        const { result } = renderHook(() =>
            useSubjectForm(recordingApi(), "cl_ann", null, vi.fn()),
        );
        for (let i = 0; i < PICKUP_PEOPLE_MAX + 2; i++)
            act(() => {
                result.current.addPickup();
            });
        expect(result.current.pickups).toHaveLength(PICKUP_PEOPLE_MAX);
    });

    it("asks for a name, a readable phone and short enough text before saving", () => {
        const api = recordingApi();
        const { result } = renderHook(() => useSubjectForm(api, "cl_ann", null, vi.fn()));
        const steps: ((f: typeof result.current) => void)[] = [
            (f) => {
                f.setName("Mia");
                f.setValue("no_pickup", "x".repeat(501));
            },
            (f) => {
                f.addPickup();
            },
            (f) => {
                f.addPickup();
            },
            (f) => {
                f.setPickup(0, "phone", "555-01");
            },
            (f) => {
                f.setPickup(1, "name", "n".repeat(81));
            },
            (f) => {
                f.submit();
            },
        ];
        for (const step of steps)
            act(() => {
                step(result.current);
            });
        expect(result.current.errors).toEqual({
            no_pickup: s.tooLong(500),
            "pickups.0.name": s.pickup.nameRequired,
            "pickups.0.phone": s.pickup.phoneInvalid,
            "pickups.1.name": s.tooLong(80),
        });
        expect(api.sent).toEqual([]);
    });

    it("sends the typed people, drops blank ones and keeps other details", async () => {
        const api = recordingApi();
        const done = vi.fn();
        const { result } = renderHook(() => useSubjectForm(api, "cl_ann", student, done));
        const steps: ((f: typeof result.current) => void)[] = [
            (f) => {
                f.addPickup();
            },
            (f) => {
                f.addPickup();
            },
            (f) => {
                f.setPickup(1, "name", " Ngozi Nwosu ");
            },
            (f) => {
                f.setPickup(1, "phone", "613-555-0181");
            },
            (f) => {
                f.setValue("no_pickup", "Not to be released to Kevin Byrne.");
            },
        ];
        for (const step of steps)
            act(() => {
                step(result.current);
            });
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(api.sent).toEqual([
            {
                name: "Mia",
                attributes: {
                    grade: "Grade 4",
                    no_pickup: "Not to be released to Kevin Byrne.",
                    pickups: [
                        { name: "Rosa Lindqvist", relation: "Aunt" },
                        { name: "Ngozi Nwosu", phone: "613-555-0181" },
                    ],
                },
            },
        ]);
    });
});
