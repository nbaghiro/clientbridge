import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { type TreatmentNote, answerRows, canKeepNotes, noteByline, noteVisit } from "./forms";

const ZONE = "America/Vancouver";
const f = strings.forms;

const field = (name: string, input: string, position: number, options: unknown[] = []) => ({
    id: `ff_${name}`,
    input,
    name,
    label: name.toUpperCase(),
    help: null,
    required: false,
    options,
    position,
});

function note(extra: Partial<TreatmentNote> = {}): TreatmentNote {
    return {
        id: "fr_1",
        form_id: "frm_soap",
        form_name: "SOAP note",
        client_id: "cl_1",
        parent_type: "booking",
        parent_id: "bk_1",
        submitted_at: "2026-10-07T22:20:00Z",
        fields: [
            field("plan", "longtext", 2),
            field("subjective", "longtext", 0),
            field("pressure", "select", 1, [{ value: "firm", label: "Firm" }]),
            field("areas", "multiselect", 3, ["Neck", "Back"]),
            field("cleared", "checkbox", 4),
            field("seen", "date", 5),
        ],
        answers: {
            subjective: "Neck pain",
            pressure: "firm",
            areas: ["Neck", "Back"],
            cleared: true,
            seen: "2026-10-07",
        },
        author_staff_id: "st_1",
        author_name: "Amy Chen",
        signer_name: null,
        amends: null,
        booking_id: "bk_1",
        visit_at: "2026-10-07T21:00:00Z",
        service: "60 minute massage",
        ...extra,
    };
}

describe("answerRows", () => {
    it("lists every question in order with its answer as read", () => {
        expect(answerRows(note(), ZONE)).toEqual([
            { label: "SUBJECTIVE", value: "Neck pain" },
            { label: "PRESSURE", value: "Firm" },
            { label: "PLAN", value: f.noAnswer },
            { label: "AREAS", value: "Neck, Back" },
            { label: "CLEARED", value: f.answerYes },
            { label: "SEEN", value: "October 7, 2026" },
        ]);
    });
});

describe("noteByline", () => {
    it("names the author and the time, and marks an amendment", () => {
        expect(noteByline(note(), ZONE)).toBe("Amy Chen · October 7, 2026 at 3:20 p.m.");
        expect(noteByline(note({ amends: "fr_0" }), ZONE)).toContain(f.amendment);
        expect(noteVisit(note(), ZONE)).toBe("60 minute massage · October 7, 2026");
    });
});

describe("canKeepNotes", () => {
    it("lets the visit's practitioner and managers keep notes, and no one else", () => {
        expect(canKeepNotes({ staffId: "st_1", role: "staff" }, "st_1")).toBe(true);
        expect(canKeepNotes({ staffId: "st_2", role: "admin" }, "st_1")).toBe(true);
        expect(canKeepNotes({ staffId: "st_2", role: "staff" }, "st_1")).toBe(false);
        expect(canKeepNotes(null, "st_1")).toBe(false);
    });
});
