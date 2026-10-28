import { theme } from "@clientbridge/tokens/native";
import { useWindowDimensions } from "react-native";

// The web-style layout is for wide landscape windows; portrait and Split View keep the phone layout.
export function useTabletLayout(): boolean {
    const { width, height } = useWindowDimensions();
    return width >= theme.layout.tablet && width > height;
}
