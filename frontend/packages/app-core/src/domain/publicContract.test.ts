// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type PublicContract, useContractSigning } from "./publicContract";

afterEach(cleanup);

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

const changed = (code: string | null): Error =>
    Object.assign(new Error("refused"), { status: 409, code });

it("signs the viewed version and clears consent when updated terms must be reviewed", async () => {
    const getContract = vi
        .fn()
        .mockResolvedValueOnce(doc)
        .mockResolvedValue({ ...doc, version: 2, body: "Updated" });
    const sign = vi.fn().mockRejectedValue(changed("contract_changed"));
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
    expect(result.current.error).toBe("terms-changed");
    // reread in place: the page never drops back to its loading state
    expect(result.current.status).toBe("pending");
    act(() => {
        result.current.sign();
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("consent-missing");
});

it("rereads a request that closed elsewhere and shows it without a failure", async () => {
    const getContract = vi
        .fn()
        .mockResolvedValueOnce(doc)
        .mockResolvedValue({ ...doc, status: "declined" });
    const sign = vi.fn().mockRejectedValue(changed("conflict"));
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
        expect(result.current.status).toBe("declined");
    });
    expect(result.current.error).toBeNull();
});

it("declines only after the client confirms", async () => {
    const decline = vi.fn().mockResolvedValue({ ...doc, status: "declined" });
    const contracts = { getContract: vi.fn().mockResolvedValue(doc), sign: vi.fn(), decline };
    const { result } = renderHook(() => useContractSigning(contracts, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("pending");
    });
    act(() => {
        result.current.setDeclining(true);
    });
    expect(result.current.declining).toBe(true);
    act(() => {
        result.current.setDeclining(false);
    });
    expect(decline).not.toHaveBeenCalled();
    act(() => {
        result.current.setDeclining(true);
    });
    act(() => {
        result.current.decline();
    });
    await waitFor(() => {
        expect(result.current.status).toBe("declined");
    });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(result.current.declining).toBe(false);
});

it("shows a request signed elsewhere when a stale page declines it", async () => {
    const getContract = vi
        .fn()
        .mockResolvedValueOnce(doc)
        .mockResolvedValue({ ...doc, status: "signed" });
    const decline = vi.fn().mockRejectedValue(changed("conflict"));
    const contracts = { getContract, sign: vi.fn(), decline };
    const { result } = renderHook(() => useContractSigning(contracts, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("pending");
    });
    act(() => {
        result.current.setDeclining(true);
    });
    act(() => {
        result.current.decline();
    });
    await waitFor(() => {
        expect(result.current.status).toBe("signed");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.declining).toBe(false);
});

it("says the terms changed and keeps consent when the reread fails", async () => {
    const getContract = vi
        .fn()
        .mockResolvedValueOnce(doc)
        .mockRejectedValue(new TypeError("Failed to fetch"));
    const sign = vi.fn().mockRejectedValue(changed("contract_changed"));
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
        expect(result.current.busy).toBe(false);
    });
    expect(getContract).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("terms-changed");
    expect(result.current.agreed).toBe(true);
});

it("names a failed decline as a decline and keeps the question open", async () => {
    const decline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const contracts = { getContract: vi.fn().mockResolvedValue(doc), sign: vi.fn(), decline };
    const { result } = renderHook(() => useContractSigning(contracts, "token"));
    await waitFor(() => {
        expect(result.current.status).toBe("pending");
    });
    act(() => {
        result.current.setDeclining(true);
    });
    act(() => {
        result.current.decline();
    });
    await waitFor(() => {
        expect(result.current.error).toBe("decline-failed");
    });
    expect(result.current.declining).toBe(true);
    expect(result.current.status).toBe("pending");
});
