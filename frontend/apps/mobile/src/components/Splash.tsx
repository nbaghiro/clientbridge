import { Logo } from "@clientbridge/ui";
import { strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 200 });

export function revealApp() {
    SplashScreen.hide();
}

export function Splash() {
    const opacity = useRef(new Animated.Value(1)).current;
    const [reducedMotion, setReducedMotion] = useState(true);

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
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 0.55,
                    duration: 1000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 1000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        pulse.start();
        return () => {
            pulse.stop();
            opacity.setValue(1);
        };
    }, [opacity, reducedMotion]);

    return (
        <View
            style={styles.page}
            accessibilityRole="progressbar"
            accessibilityLabel={strings.common.loading}
        >
            <Animated.View style={{ opacity }}>
                <Logo height={81} />
            </Animated.View>
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
});
