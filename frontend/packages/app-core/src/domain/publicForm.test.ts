// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { type PublicForm, useFormUploads, usePublicFormFill } from "./publicForm";

afterEach(cleanup);

it("requires explicit consent and sends the printed signature with the answers", async () => {
    const form: PublicForm = {
        form_name: "Intake",
        business_name: "Demo",
        brand: { logo_url: null, primary: null, tagline: null },
        timezone: "America/Toronto",
        completed: false,
        require_signature: true,
        fields: [],
    };
    const client = {
        getForm: vi.fn().mockResolvedValue(form),
        submit: vi.fn().mockResolvedValue({ ...form, completed: true }),
        upload: vi.fn(),
    };
    const { result } = renderHook(() => usePublicFormFill(client, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("ready");
    });
    act(() => {
        result.current.submit();
    });
    expect(client.submit).not.toHaveBeenCalled();
    act(() => {
        result.current.setSigner(" Pat ");
    });
    act(() => {
        result.current.submit();
    });
    expect(client.submit).not.toHaveBeenCalled();
    act(() => {
        result.current.setAgreed(true);
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.status).toBe("done");
    });
    expect(client.submit).toHaveBeenCalledWith("token", {}, { name: "Pat", agreed: true });
});

const unsigned: PublicForm = {
    form_name: "Intake",
    business_name: "Demo",
    brand: { logo_url: null, primary: null, tagline: null },
    timezone: "America/Toronto",
    completed: false,
    require_signature: false,
    fields: [
        {
            id: "ff_record",
            input: "file",
            name: "record",
            label: "Vaccine record",
            help: null,
            required: false,
            options: [],
            position: 0,
        },
    ],
};

it("shows a form sent from another tab as done instead of failing", async () => {
    const already = Object.assign(new Error("409"), { status: 409, code: "form_submitted" });
    const client = {
        getForm: vi
            .fn()
            .mockResolvedValueOnce(unsigned)
            .mockResolvedValue({ ...unsigned, completed: true }),
        submit: vi.fn().mockRejectedValue(already),
        upload: vi.fn(),
    };
    const { result } = renderHook(() => usePublicFormFill(client, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("ready");
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.status).toBe("done");
    });
    expect(result.current.error).toBeNull();
});

it("keeps other refusals as an error to retry", async () => {
    const client = {
        getForm: vi.fn().mockResolvedValue(unsigned),
        submit: vi.fn().mockRejectedValue(Object.assign(new Error("422"), { status: 422 })),
        upload: vi.fn(),
    };
    const { result } = renderHook(() => usePublicFormFill(client, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("ready");
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.publicForm.submitAnswersError);
    });
    expect(result.current.status).toBe("ready");
    expect(client.getForm).toHaveBeenCalledTimes(1);
});

it("never shows a file that failed to upload as attached, and keeps the one before it", async () => {
    const pdf = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const client = {
        getForm: vi.fn().mockResolvedValue(unsigned),
        submit: vi.fn(),
        upload: vi
            .fn()
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce("fl_first")
            .mockRejectedValueOnce(new TypeError("Failed to fetch")),
    };
    const { result } = renderHook(() => {
        const fill = usePublicFormFill(client, "token");
        return { fill, uploads: useFormUploads(fill) };
    });
    await waitFor(() => {
        expect(result.current.fill.status).toBe("ready");
    });
    act(() => {
        result.current.uploads.upload("record", pdf(10), "first.pdf");
    });
    await waitFor(() => {
        expect(result.current.fill.error).toBe(strings.publicForm.fileUploadOffline);
    });
    expect(result.current.uploads.fileNames).toEqual({});
    expect(result.current.fill.answers).toEqual({});

    act(() => {
        result.current.uploads.upload("record", pdf(10), "first.pdf");
    });
    await waitFor(() => {
        expect(result.current.fill.answers).toEqual({ record: "fl_first" });
    });
    expect(result.current.uploads.fileNames).toEqual({ record: "first.pdf" });

    act(() => {
        result.current.uploads.upload("record", pdf(10), "second.pdf");
    });
    await waitFor(() => {
        expect(result.current.fill.error).toBe(strings.publicForm.fileUploadOffline);
    });
    expect(result.current.uploads.fileNames).toEqual({ record: "first.pdf" });
    expect(result.current.fill.answers).toEqual({ record: "fl_first" });
    expect(client.upload).toHaveBeenCalledTimes(3);
});

it("ignores a file picked while another is still uploading", async () => {
    let finish: (id: string) => void = () => undefined;
    const client = {
        getForm: vi.fn().mockResolvedValue(unsigned),
        submit: vi.fn(),
        upload: vi.fn().mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                }),
        ),
    };
    const { result } = renderHook(() => {
        const fill = usePublicFormFill(client, "token");
        return { fill, uploads: useFormUploads(fill) };
    });
    await waitFor(() => {
        expect(result.current.fill.status).toBe("ready");
    });
    const pdf = new Blob(["%PDF"], { type: "application/pdf" });
    act(() => {
        result.current.uploads.upload("record", pdf, "first.pdf");
    });
    await waitFor(() => {
        expect(result.current.fill.busy).toBe(true);
    });
    act(() => {
        result.current.uploads.upload("record", pdf, "second.pdf");
    });
    expect(result.current.uploads.fileNames).toEqual({ record: "first.pdf" });
    act(() => {
        finish("fl_first");
    });
    await waitFor(() => {
        expect(result.current.fill.answers).toEqual({ record: "fl_first" });
    });
    expect(client.upload).toHaveBeenCalledTimes(1);
});
