import "./console";

import * as ui from "@clientbridge/ui";
import { StyleSheet, View } from "react-native";
import { SafeAreaFrameContext, SafeAreaInsetsContext } from "react-native-safe-area-context";

import { Rendered } from "../Render";
import type { ControlValue } from "../story";
import { findPage } from "../stories";
import { DEVICES } from "./Frame";
import { mobileKit } from "./MobileKit";
import { theme } from "./nativeTheme";

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

// One example drawn in React Native beside its web twin, at the device's width.
export default function Inline({
    page,
    component,
    example,
    device,
    values,
}: {
    page: string;
    component: string;
    example: string;
    device: "iphone" | "android";
    values?: Readonly<Record<string, ControlValue>> | undefined;
}) {
    const entry = findPage(page)?.stories.find((s) => s.component === component);
    const ex = entry?.examples.find((e) => e.key === example);
    if (!entry || !ex) return null;
    const d = DEVICES[device];
    return (
        <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width: d.width, height: d.height }}>
            <SafeAreaInsetsContext.Provider value={NO_INSETS}>
                <View style={[styles.root, { width: d.width }]}>
                    <Rendered entry={entry} example={ex} kit={mobileKit} ui={ui} values={values} />
                </View>
            </SafeAreaInsetsContext.Provider>
        </SafeAreaFrameContext.Provider>
    );
}

const styles = StyleSheet.create({
    root: { backgroundColor: theme.colors.bg, padding: 16 },
});
