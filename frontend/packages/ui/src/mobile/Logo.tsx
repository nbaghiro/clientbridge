import { LOGO, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type StyleProp, Text, View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

export function Logo({
    height = 28,
    color = theme.colors.accent,
}: {
    height?: number;
    color?: string;
}) {
    const width = height * LOGO.aspect;
    return (
        <Svg
            width={width}
            height={height}
            viewBox={LOGO.viewBox}
            fill="none"
            style={{ width, height }}
        >
            {LOGO.paths.map((d) => (
                <Path
                    key={d}
                    d={d}
                    stroke={color}
                    strokeWidth={LOGO.strokeWidth}
                    strokeLinecap="round"
                />
            ))}
        </Svg>
    );
}

export function Lockup({
    fontSize,
    markColor,
    textColor,
    style,
}: {
    fontSize: number;
    markColor: string;
    textColor: string;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <View style={[{ flexDirection: "row", alignItems: "center", gap: LOGO.gap }, style]}>
            <Logo height={fontSize * LOGO.heightPerFontSize} color={markColor} />
            <Text style={{ color: textColor, fontSize, fontWeight: "700", letterSpacing: -0.3 }}>
                {strings.common.appName}
            </Text>
        </View>
    );
}
