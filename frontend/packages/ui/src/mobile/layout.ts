import { theme } from "@clientbridge/tokens/native";
import { useWindowDimensions } from "react-native";

export function useTabletLayout(): boolean {
    return useWindowDimensions().width >= theme.layout.tablet;
}
