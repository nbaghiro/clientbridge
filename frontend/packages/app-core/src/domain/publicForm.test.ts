// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type PublicForm, usePublicFormFill } from "./publicForm";

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
