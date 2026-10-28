import { LOGO, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 200 });

export function revealApp() {
    SplashScreen.hide();
}

const TURN_MS = 3200;
const HEIGHT = 81;
const WIDTH = HEIGHT * LOGO.aspect;
// The rings share a centre at (14.4, 14.4) in the mark's 24.763 × 28.8 view box.
const ORIGIN = [(14.4 / 24.763) * WIDTH, (14.4 / 28.8) * HEIGHT, 0];
let started: number | null = null;
// The web loader's ease, sampled so the native driver can run it.
const ease = Easing.bezier(0.45, 0, 0.55, 1);
const STEPS = Array.from({ length: 33 }, (_, i) => i / 32);
const TURN = STEPS.map((x) => `${String(ease(x) * 360)}deg`);
const BACK = STEPS.map((x) => `${String(-ease(x) * 360)}deg`);

function phaseNow(): number {
    started ??= Date.now();
    return ((Date.now() - started) % TURN_MS) / TURN_MS;
}

export function Splash() {
    const [reducedMotion, setReducedMotion] = useState(true);
    // Starts at rest to match the native splash it replaces; later stages continue the same turn.
    const spin = useRef(new Animated.Value(phaseNow())).current;

    useEffect(() => {
        let active = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (active) setReducedMotion(value);
            })
            .catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener(
            "reduceMotionChanged",
            setReducedMotion,
        );
        return () => {
            active = false;
            subscription.remove();
        };
    }, []);

    useEffect(() => {
        if (reducedMotion) return;
        const turn = (duration: number): Animated.CompositeAnimation =>
            Animated.timing(spin, {
                toValue: 1,
                duration,
                easing: Easing.linear,
                useNativeDriver: true,
            });
        const phase = phaseNow();
        spin.setValue(phase);
        const run = Animated.sequence([
            turn((1 - phase) * TURN_MS),
            Animated.loop(
                Animated.sequence([
                    Animated.timing(spin, { toValue: 0, duration: 0, useNativeDriver: true }),
                    turn(TURN_MS),
                ]),
            ),
        ]);
        run.start();
        return () => {
            run.stop();
        };
    }, [spin, reducedMotion]);

    const ring = (d: string, outputRange: string[]) => (
        <Animated.View
            key={d}
            style={[
                styles.ring,
                {
                    transformOrigin: ORIGIN,
                    transform: [
                        {
                            rotate: reducedMotion
                                ? "0deg"
                                : spin.interpolate({ inputRange: STEPS, outputRange }),
                        },
                    ],
                },
            ]}
        >
            <Svg width={WIDTH} height={HEIGHT} viewBox={LOGO.viewBox} fill="none">
                <Path
                    d={d}
                    stroke={theme.colors.accent}
                    strokeWidth={LOGO.strokeWidth}
                    strokeLinecap="round"
                />
            </Svg>
        </Animated.View>
    );

    return (
        <View
            style={styles.page}
            accessibilityRole="progressbar"
            accessibilityLabel={strings.common.loading}
        >
            <View style={styles.mark}>
                {ring(LOGO.paths[0], TURN)}
                {ring(LOGO.paths[1], BACK)}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        alignSelf: "stretch",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.bg,
    },
    mark: { width: WIDTH, height: HEIGHT },
    ring: { position: "absolute", top: 0, left: 0 },
});
