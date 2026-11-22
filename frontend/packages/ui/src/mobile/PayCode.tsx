import { useMemo } from "react";
import { PAY_CODE_QUIET_ZONE, type PayCodeProps, payCodeMatrix } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import Svg, { Path } from "react-native-svg";

import type { NativeProps } from "./props";

export function PayCode({ value, size = 96, label, style }: NativeProps<PayCodeProps>) {
    const { n, d } = useMemo(() => {
        const m = payCodeMatrix(value);
        return {
            n: m.length,
            d: m
                .flatMap((row, r) =>
                    row.map((on, c) => (on ? `M${String(c)} ${String(r)}h1v1h-1z` : "")),
                )
                .join(""),
        };
    }, [value]);
    const origin = String(-PAY_CODE_QUIET_ZONE);
    const side = String(n + PAY_CODE_QUIET_ZONE * 2);
    return (
        <Svg
            width={size}
            height={size}
            viewBox={`${origin} ${origin} ${side} ${side}`}
            accessibilityLabel={label}
            accessibilityRole="image"
            style={[{ width: size, height: size, backgroundColor: theme.colors.surface }, style]}
        >
            <Path d={d} fill={theme.colors.ink} />
        </Svg>
    );
}
