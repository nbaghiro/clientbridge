import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { noticesNeedAttention, requirementCopy } from "./gettingPaid";

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
