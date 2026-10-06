import type { ItemImageProps } from "@clientbridge/app-core";

import { story } from "../story";

const PHOTO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#E8DCC8"/><circle cx="20" cy="18" r="9" fill="#B08D57"/></svg>',
    );

export default story<ItemImageProps>({
    component: "ItemImage",
    summary: "A catalog item's picture, or its initial on a tint of its colour when there is none.",
    controls: { name: { type: "text" }, size: { type: "number", min: 24, max: 96, step: 4 } },
    examples: [
        { key: "initial", title: "No photo", props: () => ({ src: null, name: "Full groom" }) },
        {
            key: "colour",
            title: "Item colour",
            props: () => ({ src: null, name: "Nail trim", color: "#2E7A5A" }),
        },
        { key: "photo", title: "Photo", props: () => ({ src: PHOTO, name: "Oatmeal shampoo" }) },
        {
            key: "large",
            title: "Large",
            props: () => ({ src: null, name: "Blueberry facial", color: "#7A5C99", size: 72 }),
        },
    ],
});
