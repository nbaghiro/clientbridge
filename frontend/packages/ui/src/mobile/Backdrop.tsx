import { type BackdropProps, CONTOURS } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { NativeProps } from "./props";

const c = theme.colors;

/** The marketing site's contour lines, faint in a screen's corner and fading out. */
export function Backdrop({ corner = "topRight", style }: NativeProps<BackdropProps>) {
    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.box, corner === "topRight" ? styles.top : styles.bottom, style]}
        >
            <Svg
                width="100%"
                height="100%"
                viewBox={CONTOURS.viewBox}
                preserveAspectRatio="xMaxYMin slice"
            >
                {CONTOURS.rings.map((r, i) => (
                    <Path
                        key={r.d.slice(0, 24)}
                        d={r.d}
                        fill="none"
                        stroke={r.index ? c.border : c.accentLine}
                        strokeWidth={1}
                        // Outer rings fade, the way the web version's mask fades toward the page.
                        strokeOpacity={1 - (i / CONTOURS.rings.length) * 0.8}
                    />
                ))}
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { position: "absolute", right: 0, width: 300, height: 170 },
    top: { top: 0 },
    bottom: { bottom: 0, transform: [{ scaleY: -1 }] },
});
