import { theme } from "@clientbridge/tokens/native";
import { createContext } from "react";
import { useWindowDimensions } from "react-native";

// The web-style layout is for wide landscape windows; portrait and Split View keep the phone layout.
export function useTabletLayout(): boolean {
    const { width, height } = useWindowDimensions();
    return width >= theme.layout.tablet && width > height;
}

// Set by the app shell in the tablet layout; page headers show the sidebar button while it is set.
export const SidebarContext = createContext<{ hidden: boolean; toggle: () => void } | null>(null);
