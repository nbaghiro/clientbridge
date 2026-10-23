import { describe, expect, it } from "vitest";

import { type Letterhead, type PostalParts, addressLines, printedDoc } from "./printing";

const ADDRESS: PostalParts = {
    unit: "4",
    street_number: "1250",
    street_name: "Main St",
    city: "Vancouver",
    province: "BC",
    postal_code: "V6B 1A1",
};

const LETTERHEAD: Letterhead = {
    name: "Birch Studio",
    tagline: null,
    brandColor: null,
    email: "billing@birch.test",
    gstHstNumber: null,
    qstNumber: null,
};

const doc = (letterhead: Letterhead) =>
    printedDoc(
        {
            kind: "invoice",
            currency: "CAD",
            number: "1001",
            partyName: "Ann Tremblay",
            partyLines: [],
            meta: [],
            lines: [],
            taxes: [],
            totals: [],
            headline: { label: "Total", cents: 0 },
        },
        letterhead,
        "#000",
    );

describe("addressLines", () => {
    it("prints the street line the Canada Post way, then the city line", () => {
        expect(addressLines(ADDRESS)).toEqual(["4-1250 Main St", "Vancouver, BC, V6B 1A1"]);
        expect(addressLines({ ...ADDRESS, unit: " " })).toEqual([
            "1250 Main St",
            "Vancouver, BC, V6B 1A1",
        ]);
    });

    it("leaves out the parts a business has not filled in", () => {
        expect(addressLines({ ...ADDRESS, street_number: null, postal_code: "" })).toEqual([
            "Main St",
            "Vancouver, BC",
        ]);
        expect(addressLines({ ...ADDRESS, street_name: null, city: null })).toEqual([
            "BC, V6B 1A1",
        ]);
        expect(
            addressLines({
                unit: null,
                street_number: null,
                street_name: null,
                city: null,
                province: null,
                postal_code: null,
            }),
        ).toEqual([]);
    });
});

describe("the printed letterhead", () => {
    it("carries the business address and a readable phone", () => {
        const printed = doc({
            ...LETTERHEAD,
            address: addressLines(ADDRESS),
            phone: "+16045550142",
        });
        expect(printed.business.address).toEqual(["4-1250 Main St", "Vancouver, BC, V6B 1A1"]);
        expect(printed.business.phone).toBe("(604) 555-0142");
    });

    it("prints no address or phone for a business without them", () => {
        expect(doc(LETTERHEAD).business).toMatchObject({ address: [], phone: "" });
    });
});
