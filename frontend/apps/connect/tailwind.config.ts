import { clientbridgePreset } from "@clientbridge/tokens/tailwind-preset";
import type { Config } from "tailwindcss";

export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    presets: [clientbridgePreset],
} satisfies Config;
