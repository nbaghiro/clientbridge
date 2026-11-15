// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { formatClock } from "../datetime";
import { BUSINESS_CURRENCY, formatMoney, formatNumber, formatPhone } from "../format";
import { strings } from "../strings";
import { answerRows, formAnswerRows, sendOptions, useFormAnswers, useFormEditor } from "./forms";

afterEach(cleanup);

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

describe("answerRows formatting", () => {
    it("reads a phone and a number as the formatter shows them", () => {
        const response = {
            fields: [field("mobile", "phone", 0), field("weight", "number", 1)],
            answers: { mobile: "+12505550180", weight: "10.5" },
        };
        expect(answerRows(response, ZONE)).toEqual([
            { label: "MOBILE", value: formatPhone("+12505550180") },
            { label: "WEIGHT", value: formatNumber(10.5) },
        ]);
    });

    it("keeps every digit the client typed and never groups an ID", () => {
        const response = {
            fields: [
                field("weight", "number", 0),
                field("chip", "number", 1),
                field("long", "number", 2),
                field("blank", "number", 3),
            ],
            answers: {
                weight: "10.5555",
                chip: "985112345678901",
                long: "12345678901234567890",
                blank: "   ",
            },
        };
        expect(answerRows(response, ZONE).map((r) => r.value)).toEqual([
            formatNumber(10.5555, { useGrouping: false, maximumFractionDigits: 20 }),
            formatNumber(985112345678901, { useGrouping: false }),
            "12345678901234567890",
            f.noAnswer,
        ]);
    });

    it("reads an amount as money and a time as a clock shows it", () => {
        const response = {
            fields: [field("deposit", "currency", 0), field("arrival", "time", 1)],
            answers: { deposit: "12.50", arrival: "14:30" },
        };
        expect(answerRows(response, ZONE).map((r) => r.value)).toEqual([
            formatMoney(1250, BUSINESS_CURRENCY),
            formatClock("14:30"),
        ]);
    });
});

describe("formAnswerRows", () => {
    const submitted = {
        id: "fr_1",
        form_id: "frm_1",
        form_name: "Intake",
        client_id: "cl_1",
        parent_type: null,
        parent_id: null,
        submitted_at: "2026-10-13T17:00:00Z",
        fields: [field("record", "file", 0), field("photo", "image", 1), field("name", "text", 2)],
        answers: { record: "fl_record", photo: "fl_photo", name: "Bella" },
        signer_name: "Amélie Tremblay",
    };

    it("links each attached file once its link loads and names who signed", () => {
        expect(formAnswerRows(submitted, ZONE, { fl_record: "https://files.test/record" })).toEqual(
            [
                { label: "RECORD", value: f.answerAttached, fileUrl: "https://files.test/record" },
                { label: "PHOTO", value: f.answerAttached, fileUrl: null },
                { label: "NAME", value: "Bella", fileUrl: null },
                { label: f.signedBy, value: "Amélie Tremblay", fileUrl: null },
            ],
        );
    });

    it("says a file could not be loaded when its link failed, instead of only that one is attached", () => {
        const rows = formAnswerRows(submitted, ZONE, { fl_record: "https://files.test/record" }, [
            "fl_photo",
        ]);
        expect(rows.slice(0, 2)).toEqual([
            { label: "RECORD", value: f.answerAttached, fileUrl: "https://files.test/record" },
            { label: "PHOTO", value: f.fileUnavailable, fileUrl: null },
        ]);
    });

    it("adds no signer row to a form nobody signed", () => {
        const rows = formAnswerRows({ ...submitted, signer_name: null }, ZONE, {});
        expect(rows.map((r) => r.label)).toEqual(["RECORD", "PHOTO", "NAME"]);
    });
});

describe("useFormEditor", () => {
    const draft = {
        name: "Intake",
        requireSignature: false,
        sendOn: "manual" as const,
        active: true,
        fields: [],
    };
    const api: ApiLike = {
        get: vi.fn(),
        getText: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    };

    it("opens a form it just created as saved, and any other unsaved", () => {
        const created = renderHook(() => useFormEditor(api, "frm_new", draft, vi.fn(), true));
        expect(created.result.current.saved).toBe(true);
        const opened = renderHook(() => useFormEditor(api, "frm_old", draft, vi.fn()));
        expect(opened.result.current.saved).toBe(false);
    });
});

describe("useFormAnswers", () => {
    it("loads nothing until a response is picked, and retries a failed load", async () => {
        const get = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("503"), { status: 503 }))
            .mockResolvedValue({ id: "fr_1", form_name: "Intake" });
        const api: ApiLike = {
            get,
            getText: vi.fn(),
            post: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        };
        const { result, rerender } = renderHook(
            ({ id }: { id: string | null }) => useFormAnswers(api, id),
            { initialProps: { id: null as string | null } },
        );
        await waitFor(() => {
            expect(result.current.busy).toBe(false);
        });
        expect(get).not.toHaveBeenCalled();
        rerender({ id: "fr_1" });
        await waitFor(() => {
            expect(result.current.error).toBe(f.answersLoadError);
        });
        act(() => {
            result.current.reload();
        });
        await waitFor(() => {
            expect(result.current.answers).toMatchObject({ form_name: "Intake" });
        });
        expect(result.current.error).toBeNull();
        expect(get).toHaveBeenCalledWith("/v1/forms/responses/fr_1");
    });
});

describe("sendOptions", () => {
    it("tells two clients with the same name apart by their phone", () => {
        const client = (id: string, phone: string | null) => ({
            id,
            name: "Robin Bennett",
            phone,
            status: "active",
            lifetime_value_cents: null,
            tags: [],
            subjectNames: [],
        });
        const options = sendOptions(
            [client("cl_1", "+12505550141"), client("cl_2", "+12505550142"), client("cl_3", null)],
            (id) => (id === "cl_1" ? "https://files.example/robin.jpg" : null),
        );
        expect(options.map((o) => [o.key, o.label, o.detail])).toEqual([
            ["cl_1", "Robin Bennett", formatPhone("+12505550141")],
            ["cl_2", "Robin Bennett", formatPhone("+12505550142")],
            ["cl_3", "Robin Bennett", undefined],
        ]);
        expect(options[0]?.media).toMatchObject({ src: "https://files.example/robin.jpg" });
    });
});
