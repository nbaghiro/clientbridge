import type { ContractDocumentProps } from "@clientbridge/app-core";

import { story } from "../story";

const clauses = [
    {
        heading: "Services",
        text: "Birchbark Pet Studio grooms your pet as booked, using products suited to its coat.",
    },
    {
        heading: "Health",
        text: "Tell us about injuries, matting or anxiety before the visit; we may stop a groom for your pet's safety.",
    },
    { heading: "Cancellations", text: "Cancel at least 24 hours ahead or the deposit is kept." },
];

const signature = {
    heading: "Signed",
    name: "Amélie Tremblay",
    strokes: [
        [
            [0.05, 0.7],
            [0.15, 0.3],
            [0.25, 0.75],
            [0.35, 0.35],
            [0.45, 0.7],
        ],
        [
            [0.5, 0.6],
            [0.62, 0.4],
            [0.78, 0.65],
            [0.92, 0.45],
        ],
    ],
    facts: [
        { label: "Signed", value: "Oct 3, 2026, 8:14 a.m." },
        { label: "IP address", value: "24.68.12.40" },
    ],
} as const;

export default story<ContractDocumentProps>({
    component: "ContractDocument",
    summary: "A contract laid out as the printed page, with an optional signature block.",
    controls: {
        title: { type: "text" },
        density: { type: "select", options: ["regular", "compact"] },
    },
    examples: [
        {
            key: "signed",
            title: "Signed",
            props: () => ({
                issuer: "Birchbark Pet Studio",
                title: "Grooming agreement",
                meta: "Version 3 · for Biscuit",
                clauses,
                signature,
            }),
        },
        {
            key: "typed-name",
            title: "Signed by typed name",
            props: () => ({
                issuer: "Birchbark Pet Studio",
                title: "Photo release",
                meta: "Version 1",
                clauses: clauses.slice(0, 1),
                signature: { ...signature, name: "Diego Ruiz", strokes: null },
            }),
        },
        {
            key: "unsigned",
            title: "Unsigned",
            props: () => ({
                issuer: "Birchbark Pet Studio",
                title: "Grooming agreement",
                meta: "Draft",
                clauses,
            }),
        },
        {
            key: "compact",
            title: "Compact preview",
            props: () => ({
                issuer: "Birchbark Pet Studio",
                title: "Grooming agreement",
                meta: "Version 3",
                clauses,
                density: "compact",
            }),
        },
    ],
});
