import type { CSSProperties } from "react";

/** An example business shown on a trade page. Its logo files live in public/brands/. */
export interface Brand {
    name: string;
    city: string;
    color: string;
    tint: string;
    lockup: string;
    avatar: string;
    /** Lockup width per unit of height, from the SVG viewBox. */
    aspect: number;
}

const brand = (
    slug: string,
    name: string,
    city: string,
    color: string,
    tint: string,
    viewBoxWidth: number,
): Brand => ({
    name,
    city,
    color,
    tint,
    lockup: `/brands/${slug}.svg`,
    avatar: `/brands/${slug}-avatar.svg`,
    aspect: viewBoxWidth / 108,
});

export const BRANDS = {
    "pet-grooming": brand(
        "birchbark-pet-studio",
        "Birchbark Pet Studio",
        "Victoria, BC",
        "#2E4A3F",
        "#EDE6D8",
        399.17,
    ),
    salons: brand(
        "marlowe-hair",
        "Marlowe Hair & Colour",
        "Toronto, ON",
        "#5A2833",
        "#F4E8E5",
        397.52,
    ),
    fitness: brand(
        "forme-strength",
        "Forme Strength Studio",
        "Montréal, QC",
        "#17191C",
        "#EEF3D6",
        367.29,
    ),
    cleaning: brand(
        "sunday-home-cleaning",
        "Sunday Home Cleaning",
        "Ottawa, ON",
        "#12706B",
        "#E3F1EF",
        336.58,
    ),
    tutoring: brand(
        "bookend-learning",
        "Bookend Learning",
        "Halifax, NS",
        "#9C3E2A",
        "#F6EBDD",
        375.95,
    ),
    wellness: brand(
        "cedar-and-stone",
        "Cedar & Stone Massage Therapy",
        "Kelowna, BC",
        "#6B4F3E",
        "#F1EBE3",
        464.54,
    ),
    photography: brand(
        "northlight-photography",
        "Northlight Photography",
        "Toronto, ON",
        "#1D1D1F",
        "#F7EEDF",
        367.2,
    ),
    trades: brand(
        "level-best-home-repair",
        "Level Best Home Repair",
        "Edmonton, AB",
        "#2A2E33",
        "#FBE9DF",
        411.13,
    ),
} as const satisfies Record<string, Brand>;

export type BrandKey = keyof typeof BRANDS;

/** Re-points the accent tokens at a business's colours, for mocks of its own pages. */
export const brandStyle = (b: Brand): CSSProperties =>
    ({
        "--accent": b.color,
        "--accent-strong": b.color,
        "--accent-weak": b.tint,
        "--accent-line": b.tint,
        "--accent-ink": "#ffffff",
    }) as CSSProperties;
