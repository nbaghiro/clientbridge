import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

// Every mobile component takes a style, merged last, as an escape hatch for spacing and width.
export type NativeProps<P> = P & { style?: StyleProp<ViewStyle> };

export interface WithRef<E> {
    ref?: Ref<E> | undefined;
}
