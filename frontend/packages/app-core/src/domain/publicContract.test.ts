// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type PublicContract, useContractSigning } from "./publicContract";

afterEach(cleanup);

it("signs the viewed version and clears consent when updated terms must be reviewed", async () => {
    const doc: PublicContract = {
        contract_name: "Terms",
        business_name: "Business",
        brand: { logo_url: null, primary: null, tagline: null },
        body: "Original",
        signer_name: "Pat",
        status: "pending",
        version: 1,
        signed_at: null,
        timezone: "America/Toronto",
        signer_ip: null,
        method: null,
        typed_name: null,
        strokes: null,
    };
    const getContract = vi
        .fn()
        .mockResolvedValueOnce(doc)
        .mockResolvedValue({ ...doc, version: 2, body: "Updated" });
    const sign = vi.fn().mockRejectedValue(Object.assign(new Error("changed"), { status: 409 }));
    const contracts = { getContract, sign, decline: vi.fn() };
    const { result } = renderHook(() => useContractSigning(contracts, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("pending");
    });
    act(() => {
        result.current.setAgreed(true);
    });
    act(() => {
        result.current.sign();
    });
    await waitFor(() => {
        expect(result.current.doc?.version).toBe(2);
    });
    expect(sign).toHaveBeenCalledWith("token", {
        version: 1,
        typed_name: "Pat",
        agreed: true,
        strokes: null,
    });
    expect(result.current.agreed).toBe(false);
    act(() => {
        result.current.sign();
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("consent-missing");
});
