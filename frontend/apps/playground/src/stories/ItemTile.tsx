import type { ItemTileProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ItemTileProps>({
    component: "ItemTile",
    summary: "A catalog item to tap: the compact register key or a product card with a photo.",
    controls: {
        name: { type: "text" },
        variant: { type: "select", options: ["tile", "card"] },
        count: { type: "number", min: 0, max: 9 },
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
    ],
});
