// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, formatDate } from "../datetime";
import { strings } from "../strings";
import {
    canFinish,
    noticesNeedAttention,
    requirementCopy,
    requirementErrorCopy,
    useAccountNotices,
    useGettingPaid,
} from "./gettingPaid";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: [{ id: "bz_one" }] }),
}));

function statusApi(
    connected: boolean,
    status: Record<string, unknown> = {},
): ApiLike & { asked: string[] } {
    const asked: string[] = [];
    return {
        asked,
        get: <T>(path: string) => {
            asked.push(path);
            return Promise.resolve({ connected, ...status } as T);
        },
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("useAccountNotices", () => {
    it("shows Stripe's notices only to a manager of a business that takes payments", async () => {
        const merchant = statusApi(true);
        const { result } = renderHook(() => useAccountNotices(merchant, "owner"));
        await waitFor(() => {
            expect(result.current).not.toBeNull();
        });
        const billingOnly = statusApi(false);
        const quiet = renderHook(() => useAccountNotices(billingOnly, "owner"));
        await waitFor(() => {
            expect(billingOnly.asked).toEqual(["/v1/connect/status"]);
        });
        expect(quiet.result.current).toBeNull();
        const staff = statusApi(true);
        expect(renderHook(() => useAccountNotices(staff, "staff")).result.current).toBeNull();
        expect(staff.asked).toEqual([]);
    });
});

const g = strings.gettingPaid;

describe("requirementCopy", () => {
    it("explains the requirements a business acts on most", () => {
        expect(requirementCopy("external_account")).toEqual({
            label: g.reqExternalAccount,
            why: g.reqWhy.bankAccount,
        });
        expect(requirementCopy("identity.individual.id_numbers")).toEqual({
            label: g.reqIdNumber,
            why: g.reqWhy.idNumber,
        });
        expect(requirementCopy("identity.attestations.terms_of_service.account.date")).toEqual({
            label: g.reqTosAcceptance,
            why: g.reqWhy.terms,
        });
        expect(requirementCopy("identity.individual.documents.primary_verification").label).toBe(
            g.reqPhotoId,
        );
    });

    it("labels business and personal fields by their Accounts v2 names", () => {
        expect(requirementCopy("identity.business_details.id_numbers.ca_cn").label).toBe(
            g.reqBusinessNumber,
        );
        expect(requirementCopy("identity.business_details.address.city").label).toBe(
            g.reqBusinessAddress,
        );
        expect(requirementCopy("identity.individual.date_of_birth.day").label).toBe(
            g.reqDateOfBirth,
        );
        expect(requirementCopy("representative.address.line1").label).toBe(g.reqHomeAddress);
        expect(requirementCopy("owners.given_name").label).toBe(g.reqFirstName);
        expect(requirementCopy("identity.individual.relationship.title").label).toBe(g.reqJobTitle);
        expect(requirementCopy("configuration.merchant.mcc").label).toBe(g.reqBusinessCategory);
    });

    it("falls back to the generic message", () => {
        expect(requirementCopy("inquiry.risk_review")).toEqual({ label: g.reqOther, why: "" });
        expect(requirementCopy("external_accounts_extra").label).toBe(g.reqOther);
    });
});

describe("noticesNeedAttention", () => {
    it("prompts a review when Stripe holds or restricts the account", () => {
        expect(noticesNeedAttention("restricted", 0)).toBe(true);
        expect(noticesNeedAttention("payouts_paused", 0)).toBe(true);
        expect(noticesNeedAttention("disabled", 0)).toBe(true);
        expect(noticesNeedAttention("enabled", 1)).toBe(true);
    });

    it("stays quiet during first setup, review and a clear account", () => {
        expect(noticesNeedAttention("in_progress", 3)).toBe(false);
        expect(noticesNeedAttention("not_connected", 0)).toBe(false);
        expect(noticesNeedAttention("pending", 1)).toBe(false);
        expect(noticesNeedAttention("enabled", 0)).toBe(false);
    });
});

describe("requirementErrorCopy", () => {
    it("explains the errors a business can fix", () => {
        expect(requirementErrorCopy("verification_failed_id_number_match")).toBe(
            g.reqError.identity,
        );
        expect(requirementErrorCopy("verification_document_expired")).toBe(
            g.reqError.documentExpired,
        );
        expect(requirementErrorCopy("verification_document_name_mismatch")).toBe(
            g.reqError.documentMismatch,
        );
        expect(requirementErrorCopy("verification_document_not_readable")).toBe(
            g.reqError.document,
        );
        expect(requirementErrorCopy("invalid_address_po_boxes_disallowed")).toBe(
            g.reqError.address,
        );
        expect(requirementErrorCopy("verification_failed_tax_id_match")).toBe(
            g.reqError.businessNumber,
        );
        expect(requirementErrorCopy("invalid_url_website_inaccessible")).toBe(g.reqError.website);
    });

    it("falls back to the generic message", () => {
        expect(requirementErrorCopy("verification_failed_other")).toBe(g.reqError.other);
        expect(requirementErrorCopy("invalid_url")).toBe(g.reqError.other);
    });
});

describe("canFinish", () => {
    it("offers the form whenever something is due", () => {
        expect(canFinish("in_progress", 0)).toBe(true);
        expect(canFinish("restricted", 0)).toBe(true);
        expect(canFinish("payouts_paused", 1)).toBe(true);
        expect(canFinish("enabled", 1)).toBe(true);
        expect(canFinish("pending", 1)).toBe(true);
    });

    it("hides it when nothing is due or only support can help", () => {
        expect(canFinish("payouts_paused", 0)).toBe(false);
        expect(canFinish("enabled", 0)).toBe(false);
        expect(canFinish("disabled", 2)).toBe(false);
        expect(canFinish("not_connected", 2)).toBe(false);
    });
});

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Toronto" }, children);

function connected(status: Record<string, unknown>) {
    return statusApi(true, {
        charges_enabled: true,
        payouts_enabled: true,
        disabled_reason: null,
        currently_due: [],
        past_due: [],
        current_deadline: null,
        available_cents: null,
        pending_cents: null,
        ...status,
    });
}

describe("useGettingPaid", () => {
    it("shows payouts paused with the finish action and the rejected details", async () => {
        const api = connected({
            kyc_status: "payouts_paused",
            payouts_enabled: false,
            past_due: ["external_account"],
            currently_due: ["identity.individual.id_numbers"],
            requirement_errors: [
                {
                    requirement: "identity.individual.id_numbers",
                    code: "verification_failed_id_number_match",
                },
                { requirement: "identity.individual.id_numbers", code: "something_new" },
            ],
        });
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).toBe("payouts_paused");
        });
        expect(result.current.title).toBe(g.pausedTitle);
        expect(result.current.message).toBe(g.pausedBodyNoDate);
        expect(result.current.canFinish).toBe(true);
        expect(result.current.requirements.map((r) => [r.key, r.pastDue, r.errors])).toEqual([
            ["external_account", true, []],
            ["identity.individual.id_numbers", false, [g.reqError.identity, g.reqError.other]],
        ]);
    });

    it("says payouts wait on verification when nothing is due", async () => {
        const api = connected({ kyc_status: "payouts_paused", payouts_enabled: false });
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).toBe("payouts_paused");
        });
        expect(result.current.message).toBe(g.pausedBodyReview);
        expect(result.current.canFinish).toBe(false);
    });

    it("names the deadline only while it is still ahead", async () => {
        const ahead = new Date(Date.now() + 30 * 86_400_000);
        const cases: [string, string][] = [
            ["2026-01-15T00:00:00Z", g.pausedBodyNoDate],
            [ahead.toISOString(), g.pausedBody(formatDate(ahead, "America/Toronto"))],
        ];
        for (const [deadline, message] of cases) {
            const api = connected({
                kyc_status: "payouts_paused",
                payouts_enabled: false,
                currently_due: ["external_account"],
                current_deadline: deadline,
            });
            const { result } = renderHook(() => useGettingPaid(api), { wrapper });
            await waitFor(() => {
                expect(result.current.phase).toBe("payouts_paused");
            });
            expect(result.current.message).toBe(message);
        }
    });

    it("says card payments are paused when the card capability is off", async () => {
        const api = connected({
            kyc_status: "restricted",
            charges_enabled: false,
            payouts_enabled: false,
            currently_due: ["identity.individual.id_numbers"],
        });
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).toBe("restricted");
        });
        expect(result.current.title).toBe(g.restrictedTitle);
        expect(result.current.message).toBe(g.restrictedBody);
        expect(result.current.canFinish).toBe(true);
    });

    it("keeps the finish action on an enabled account with an upcoming requirement", async () => {
        const api = connected({
            kyc_status: "enabled",
            currently_due: ["identity.individual.id_numbers"],
        });
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).toBe("enabled");
        });
        expect(result.current.message).toBe(g.readyBody);
        expect(result.current.canFinish).toBe(true);
    });

    it("asks Stripe for the account when the owner refreshes", async () => {
        const base = connected({ kyc_status: "pending", charges_enabled: false });
        const posted: string[] = [];
        const ready = { connected: true, kyc_status: "enabled", charges_enabled: true };
        const api: ApiLike = {
            ...base,
            post: <T>(path: string) => {
                posted.push(path);
                return Promise.resolve({ ...ready, payouts_enabled: true } as T);
            },
        };
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).not.toBe("loading");
        });
        result.current.refresh();
        await waitFor(() => {
            expect(result.current.phase).toBe("enabled");
        });
        expect(posted).toEqual(["/v1/connect/refresh"]);
    });

    it("shows the stored account when Stripe can't be reached on a refresh", async () => {
        const base = connected({ kyc_status: "enabled" });
        const read: string[] = [];
        const api: ApiLike = {
            ...base,
            get: <T>(path: string) => {
                read.push(path);
                return base.get<T>(path);
            },
            post: () => Promise.reject(new Error("payments_not_configured")),
        };
        const { result } = renderHook(() => useGettingPaid(api), { wrapper });
        await waitFor(() => {
            expect(result.current.phase).toBe("enabled");
        });
        const before = read.filter((path) => path === "/v1/connect/status").length;
        result.current.refresh();
        await waitFor(() => {
            expect(read.filter((path) => path === "/v1/connect/status")).toHaveLength(before + 1);
        });
        await waitFor(() => {
            expect(result.current.phase).toBe("enabled");
        });
    });
});
