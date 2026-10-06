import { type PayCodeProps, payCodeMatrix } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import Svg, { Path } from "react-native-svg";

export function PayCode({ value, size = 96, label }: PayCodeProps) {
    const m = payCodeMatrix(value);
    const n = m.length;
    const d = m
        .flatMap((row, r) => row.map((on, c) => (on ? `M${String(c)} ${String(r)}h1v1h-1z` : "")))
        .join("");
    return (
        <Svg
            width={size}
            height={size}
            viewBox={`-2 -2 ${String(n + 4)} ${String(n + 4)}`}
            accessibilityLabel={label}
            accessibilityRole="image"
            style={{ width: size, height: size, backgroundColor: theme.colors.surface }}
        >
            <Path d={d} fill={theme.colors.ink} />
        </Svg>
    );
}
