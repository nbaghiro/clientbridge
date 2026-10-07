import type { ImagePickerProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

// A PNG, since react-native-web does not load SVG data URIs.
const PHOTO =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAgMAAAAqbBEUAAAADFBMVEXo3MiwjVeKazwAAACYQcf9AAAAhklEQVR42sXRMQrCQBCF4W/XFCnTaO1RPIIg3sfzpPIInsI6R0iZIhiLTAKSgIKCrxj2572ZZWf5m7ZnkCEdHGcoKGADJ9KuCWdSRoIqoIi+ZawS2YXzNbQwrDm9KDkS2tVpV4bbBH30vWznQyXU4H6R56v2ZMoRyjfv6cZTR+YxQvPrT38CXiITV3RjfLcAAAAASUVORK5CYII=";

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
        {
            key: "photo-large",
            title: "Large photo with both sources and remove",
            props: () => ({
                src: PHOTO,
                name: "Full groom",
                label: "Take a photo",
                hint: "Shown on your booking page.",
                size: "lg",
                onPick: noop,
                onPickAlt: noop,
                altLabel: "Choose from library",
                onRemove: noop,
                removeLabel: "Remove photo",
            }),
        },
        {
            key: "busy-photo",
            title: "Replacing a photo",
            props: () => ({
                src: PHOTO,
                name: "Slicker brush",
                label: "Uploading…",
                busy: true,
                onPick: noop,
                onRemove: noop,
                removeLabel: "Remove photo",
            }),
        },
        {
            key: "long",
            title: "Long label and hint",
            props: () => ({
                src: null,
                name: "Self-cleaning slicker brush with retractable pins",
                color: "#B08D57",
                label: "Add a photo of this product for the register and the online shop",
                hint: "JPEG, PNG or HEIC up to 10 MB. Square photos on a plain background look best in the product grid and on receipts.",
                onPick: noop,
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left",
            props: () => ({
                src: null,
                name: "شامبو الشوفان",
                color: "#2E7A5A",
                label: "أضف صورة",
                hint: "الصور المربعة أفضل.",
                onPick: noop,
            }),
        },
    ],
});
