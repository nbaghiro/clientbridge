import type { ImagePickerProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const PHOTO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#D9E4DA"/><circle cx="48" cy="44" r="22" fill="#8AA88E"/><rect x="26" y="70" width="44" height="10" rx="5" fill="#5F7F63"/></svg>',
    );

export default story<ImagePickerProps>({
    component: "ImagePicker",
    summary:
        "An item's photo with change and remove; a drop or a file on web, camera or library on mobile.",
    controls: {
        label: { type: "text" },
        hint: { type: "text" },
        size: { type: "select", options: ["md", "lg"] },
        busy: { type: "boolean" },
    },
    examples: [
        {
            key: "empty",
            title: "No photo",
            props: () => ({
                src: null,
                name: "Oatmeal shampoo",
                label: "Add a photo",
                hint: "JPEG or PNG, square works best.",
                onPick: noop,
                onPickAlt: noop,
                altLabel: "Choose from library",
            }),
        },
        {
            key: "photo",
            title: "With a photo",
            props: () => ({
                src: PHOTO,
                name: "Slicker brush",
                label: "Change photo",
                onPick: noop,
                onRemove: noop,
                removeLabel: "Remove photo",
            }),
        },
        {
            key: "large",
            title: "Large",
            props: () => ({
                src: null,
                name: "Full groom",
                color: "#7A5C99",
                label: "Add a photo",
                hint: "Shown on your booking page.",
                size: "lg",
                onPick: noop,
            }),
        },
        {
            key: "busy",
            title: "Uploading",
            props: () => ({
                src: null,
                name: "Bandana",
                label: "Uploading…",
                busy: true,
                onPick: noop,
            }),
        },
    ],
});
