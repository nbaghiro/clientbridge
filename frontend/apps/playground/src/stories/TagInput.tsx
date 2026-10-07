import type { TagInputProps } from "@clientbridge/app-core";

import { story } from "../story";

const SUGGESTIONS = [
    { tag: "nervous", count: 7 },
    { tag: "senior", count: 5 },
    { tag: "double coat", count: 4 },
    { tag: "vip", count: 3 },
    { tag: "no clippers", count: 2 },
];

export default story<TagInputProps>({
    component: "TagInput",
    summary:
        "Chips for a client's tags, with a box to add one and the business's tags offered first.",
    controls: { label: { type: "text" }, placeholder: { type: "text" } },
    examples: [
        {
            key: "default",
            title: "With tags and suggestions",
            props: () => ({
                label: "Tags",
                placeholder: "Add a tag",
                defaultTags: ["senior", "double coat"],
                suggestions: SUGGESTIONS,
            }),
        },
        {
            key: "empty",
            title: "Empty",
            props: () => ({ label: "Tags", placeholder: "Add a tag", suggestions: SUGGESTIONS }),
        },
        {
            key: "many",
            title: "Many tags wrap",
            props: () => ({
                label: "Tags",
                placeholder: "Add a tag",
                defaultTags: [
                    "senior",
                    "double coat",
                    "nervous",
                    "vip",
                    "no clippers",
                    "puppy",
                    "allergies",
                    "matting",
                ],
                suggestions: SUGGESTIONS,
            }),
        },
        {
            key: "long",
            title: "Long tag",
            props: () => ({
                label: "Tags",
                placeholder: "Add a tag",
                defaultTags: [
                    "needs a muzzle for nail trims and gets anxious around the high-velocity dryer",
                    "vip",
                ],
                suggestions: SUGGESTIONS,
            }),
        },
        {
            key: "rtl",
            title: "Hebrew tags with custom labels",
            props: () => ({
                label: "תגיות",
                placeholder: "הוספת תגית",
                defaultTags: ["ותיק", "פרווה כפולה"],
                suggestions: [{ tag: "עצבני", count: 4 }],
                removeLabel: (tag: string) => `הסרת ${tag}`,
                createLabel: (text: string) => `יצירת “${text}”`,
            }),
        },
        {
            key: "no-suggestions",
            title: "No suggestions",
            props: () => ({ label: "Tags", placeholder: "Add a tag", defaultTags: ["vip"] }),
        },
    ],
});
