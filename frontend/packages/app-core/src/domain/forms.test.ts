import { describe, expect, it } from "vitest";

import { formatParts, formatPhone } from "../format";
import { strings } from "../strings";
import { answerRows, sendOptions } from "./forms";

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

const answered = {
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
};

describe("answerRows", () => {
    it("lists every question in order with its answer as read", () => {
        expect(answerRows(answered, ZONE)).toEqual([
            { label: "SUBJECTIVE", value: "Neck pain" },
            { label: "PRESSURE", value: "Firm" },
            { label: "PLAN", value: f.noAnswer },
            { label: "AREAS", value: "Neck, Back" },
            { label: "CLEARED", value: f.answerYes },
            { label: "SEEN", value: "October 7, 2026" },
        ]);
    });
});

describe("sendOptions", () => {
    it("tells two clients with the same name apart by their contact details", () => {
        const client = (id: string, email: string | null, phone: string | null) => ({
            id,
            name: "Robin Bennett",
            email,
            phone,
            status: "active",
            lifetime_value_cents: null,
        });
        const options = sendOptions(
            [
                client("cl_1", "robin@example.ca", null),
                client("cl_2", "r.bennett@example.ca", "+12505550142"),
                client("cl_3", null, null),
            ],
            (id) => (id === "cl_1" ? "https://files.example/robin.jpg" : null),
        );
        expect(options.map((o) => [o.key, o.label, o.detail])).toEqual([
            ["cl_1", "Robin Bennett", "robin@example.ca"],
            [
                "cl_2",
                "Robin Bennett",
                formatParts([formatPhone("+12505550142"), "r.bennett@example.ca"]),
            ],
            ["cl_3", "Robin Bennett", undefined],
        ]);
        expect(options[0]?.media).toMatchObject({ src: "https://files.example/robin.jpg" });
    });
});
