import { ICON_SPECS, type IconProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export function Icon({ name, size = 20, color = theme.colors.inkSoft, label }: IconProps) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: size, height: size }}
            {...(label !== undefined ? { accessible: true, accessibilityLabel: label } : {})}
        >
            {ICON_SPECS[name].map((p, i) =>
                p.kind === "rect" ? (
                    <Rect
                        key={i}
                        // eslint-disable-next-line @typescript-eslint/no-deprecated -- rect coords, not the deprecated TransformProps x
                        x={p.x}
                        // eslint-disable-next-line @typescript-eslint/no-deprecated -- rect coords, not the deprecated TransformProps y
                        y={p.y}
                        width={p.width}
                        height={p.height}
                        {...(p.rx !== undefined ? { rx: p.rx } : {})}
                    />
                ) : p.kind === "circle" ? (
                    <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
                ) : (
                    <Path key={i} d={p.d} />
                ),
            )}
        </Svg>
    );
}
