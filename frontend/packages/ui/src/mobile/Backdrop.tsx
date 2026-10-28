import { type BackdropProps, CONTOURS } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { createContext, useContext } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { NativeProps } from "./props";

const c = theme.colors;

// Set inside a tablet's page card, whose frame draws the art once at the window's corner instead.
export const BackdropDrawn = createContext(false);

/** The marketing site's contour lines, faint in a screen's corner and fading out. */
export function Backdrop({ corner = "topRight", size = "md", style }: NativeProps<BackdropProps>) {
    if (useContext(BackdropDrawn)) return null;
    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
                styles.box,
                styles[size],
                corner === "topRight" || corner === "topLeft" ? styles.top : styles.bottom,
                corner === "topLeft" || corner === "bottomLeft" ? styles.left : styles.right,
                {
                    transform: [
                        { scaleX: corner === "topLeft" || corner === "bottomLeft" ? -1 : 1 },
                        { scaleY: corner === "bottomRight" || corner === "bottomLeft" ? -1 : 1 },
                    ],
                },
                style,
            ]}
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
    box: { position: "absolute" },
    sm: { width: 220, height: 130 },
    md: { width: 300, height: 170 },
    lg: { width: 460, height: 260 },
    top: { top: 0 },
    bottom: { bottom: 0 },
    left: { left: 0 },
    right: { right: 0 },
});
