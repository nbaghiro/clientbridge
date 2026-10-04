import type { GlyphName } from "../art/TradeGlyph";

export interface Trade {
    slug: string;
    name: string;
    glyph: GlyphName;
}

export const TRADES: readonly Trade[] = [
    { slug: "pet-grooming", name: "Pet grooming and daycare", glyph: "paw" },
    { slug: "salons", name: "Hair and beauty salons", glyph: "scissors" },
    { slug: "fitness", name: "Personal training and fitness studios", glyph: "dumbbell" },
    { slug: "cleaning", name: "Home cleaning", glyph: "spray" },
    { slug: "tutoring", name: "Tutoring and lessons", glyph: "book" },
    { slug: "wellness", name: "Massage and wellness", glyph: "stones" },
    { slug: "photography", name: "Photography", glyph: "camera" },
    { slug: "trades", name: "Home services and trades", glyph: "wrench" },
];

export const solutionPath = (slug: string): string => `/solutions/${slug}`;
