import type { ItemTileProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

// A PNG, since react-native-web does not load SVG data URIs.
const PHOTO =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAgMAAAAqbBEUAAAADFBMVEXo3MiwjVeKazwAAACYQcf9AAAAhklEQVR42sXRMQrCQBCF4W/XFCnTaO1RPIIg3sfzpPIInsI6R0iZIhiLTAKSgIKCrxj2572ZZWf5m7ZnkCEdHGcoKGADJ9KuCWdSRoIqoIi+ZawS2YXzNbQwrDm9KDkS2tVpV4bbBH30vWznQyXU4H6R56v2ZMoRyjfv6cZTR+YxQvPrT38CXiITV3RjfLcAAAAASUVORK5CYII=";

export default story<ItemTileProps>({
    component: "ItemTile",
    summary: "A catalog item to tap: the compact register key or a product card with a photo.",
    controls: {
        name: { type: "text" },
        variant: { type: "select", options: ["tile", "card"] },
        count: { type: "number", min: 0, max: 9 },
        meta: { type: "text" },
        cents: { type: "number", min: 0, step: 100 },
        disabled: { type: "boolean" },
    },
    examples: [
        {
            key: "tile",
            title: "Tile",
            props: () => ({
                name: "Full groom",
                imageSrc: null,
                color: "#3F5E80",
                cents: 8500,
                meta: "90 min",
                onPress: noop,
            }),
        },
        {
            key: "tile-count",
            title: "On the ticket",
            props: () => ({
                name: "Nail trim",
                imageSrc: null,
                color: "#2E7A5A",
                cents: 2000,
                meta: "15 min",
                count: 2,
                onPress: noop,
            }),
        },
        {
            key: "tile-tag",
            title: "Tagged",
            props: () => ({
                name: "Oatmeal shampoo (500ml)",
                imageSrc: null,
                color: "#B08D57",
                cents: 2400,
                meta: "3 left",
                tag: { label: "Low stock", intent: "warning" },
                onPress: noop,
            }),
        },
        {
            key: "tile-disabled",
            title: "Sold out",
            props: () => ({
                name: "Self-cleaning slicker brush",
                imageSrc: null,
                color: null,
                cents: 2900,
                tag: { label: "Sold out", intent: "neutral" },
                disabled: true,
                onPress: noop,
            }),
        },
        {
            key: "card",
            title: "Card",
            props: () => ({
                name: "Self-cleaning slicker brush",
                imageSrc: null,
                color: "#7A5C99",
                cents: 2900,
                meta: "Grooming tools",
                variant: "card",
                onPress: noop,
            }),
        },
        {
            key: "card-tag",
            title: "Card with a tag",
            props: () => ({
                name: "Birchbark bandana",
                imageSrc: null,
                color: "#2E7A5A",
                cents: 1200,
                meta: "Accessories",
                tag: { label: "New", intent: "accent" },
                variant: "card",
                onPress: noop,
            }),
        },
        {
            key: "tile-no-price",
            title: "No price, no colour",
            props: () => ({
                name: "Custom quote",
                imageSrc: null,
                color: null,
                cents: null,
                meta: "Price set at checkout",
                onPress: noop,
            }),
        },
        {
            key: "tile-long",
            title: "Long name and meta",
            props: () => ({
                name: "Deluxe spa package with blueberry facial, teeth brushing and paw balm",
                imageSrc: null,
                color: "#7A5C99",
                cents: 12500,
                meta: "2 h 30 min with a senior groomer",
                count: 12,
                tag: { label: "Most popular this month", intent: "success" },
                onPress: noop,
            }),
        },
        {
            key: "tile-rtl",
            title: "Right-to-left",
            props: () => ({
                name: "قص الأظافر",
                imageSrc: null,
                color: "#2E7A5A",
                cents: 2000,
                meta: "١٥ دقيقة",
                onPress: noop,
            }),
        },
        {
            key: "card-photo",
            title: "Card with a photo, on the ticket",
            props: () => ({
                name: "Oatmeal shampoo (500ml)",
                imageSrc: PHOTO,
                color: null,
                cents: 2400,
                meta: "Shampoo",
                count: 1,
                variant: "card",
                onPress: noop,
            }),
        },
        {
            key: "card-disabled",
            title: "Card, sold out, long name",
            props: () => ({
                name: "Limited edition autumn bandana with embroidered maple leaves",
                imageSrc: null,
                color: "#B08D57",
                cents: 1800,
                meta: "Accessories",
                tag: { label: "Sold out", intent: "danger" },
                variant: "card",
                disabled: true,
                onPress: noop,
            }),
        },
    ],
});
