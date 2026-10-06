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
            key: "no-suggestions",
            title: "No suggestions",
            props: () => ({ label: "Tags", placeholder: "Add a tag", defaultTags: ["vip"] }),
        },
    ],
});
