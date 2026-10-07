import type { ItemImageProps } from "@clientbridge/app-core";

import { story } from "../story";

// A PNG, since react-native-web does not load SVG data URIs.
const PHOTO =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAgMAAAAqbBEUAAAADFBMVEXo3MiwjVeKazwAAACYQcf9AAAAhklEQVR42sXRMQrCQBCF4W/XFCnTaO1RPIIg3sfzpPIInsI6R0iZIhiLTAKSgIKCrxj2572ZZWf5m7ZnkCEdHGcoKGADJ9KuCWdSRoIqoIi+ZawS2YXzNbQwrDm9KDkS2tVpV4bbBH30vWznQyXU4H6R56v2ZMoRyjfv6cZTR+YxQvPrT38CXiITV3RjfLcAAAAASUVORK5CYII=";

export default story<ItemImageProps>({
    component: "ItemImage",
    summary: "A catalog item's picture, or its initial on a tint of its colour when there is none.",
    controls: {
        name: { type: "text" },
        size: { type: "number", min: 24, max: 96, step: 4 },
        color: { type: "text" },
    },
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
        {
            key: "small",
            title: "Small",
            props: () => ({ src: null, name: "Bandana", color: "#B08D57", size: 24 }),
        },
        {
            key: "photo-large",
            title: "Large photo",
            props: () => ({ src: PHOTO, name: "Oatmeal shampoo", size: 96 }),
        },
        {
            key: "rtl",
            title: "Right-to-left name",
            props: () => ({ src: null, name: "شامبو الشوفان", color: "#3F5E80", size: 48 }),
        },
        {
            key: "lowercase",
            title: "Name starting with a digit",
            props: () => ({ src: null, name: "3-pack tennis balls", size: 48 }),
        },
    ],
});
