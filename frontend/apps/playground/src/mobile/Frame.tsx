// Installed before React Native modules load, so it sees their first warnings.
import "./console";

import * as ui from "@clientbridge/ui";
import { Fragment, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaFrameContext, SafeAreaInsetsContext } from "react-native-safe-area-context";

import { Rendered } from "../Render";
import { parseHash } from "../routes";
import type { ControlValue } from "../story";
import { findPage } from "../stories";
import { Backdrop } from "./Backdrop";
import { mobileKit } from "./MobileKit";
import { theme } from "./nativeTheme";

const c = theme.colors;

export const DEVICES = {
    iphone: { width: 393, height: 852, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
    android: { width: 412, height: 915, insets: { top: 36, bottom: 20, left: 0, right: 0 } },
} as const;

type Values = Readonly<Record<string, Readonly<Record<string, ControlValue>>>>;

// What renders inside each phone: every example of one page, in React Native through react-native-web.
export default function Frame({ hash }: { hash: string }) {
    const route = parseHash(hash);
    const [values, setValues] = useState<Values>({});
    useEffect(() => {
        document.documentElement.dataset.frame = "mobile";
        const on = (e: MessageEvent): void => {
            const data = e.data as { type?: string; values?: Values } | null;
            if (data?.type === "playground-controls" && data.values) setValues(data.values);
        };
        window.addEventListener("message", on);
        window.parent.postMessage({ type: "playground-frame-ready" }, "*");
        return () => {
            window.removeEventListener("message", on);
        };
    }, []);
    const example = route.kind === "frame" ? route.example : null;
    useEffect(() => {
        if (example !== null) document.getElementById(example)?.scrollIntoView();
    }, [example]);
    if (route.kind !== "frame") return null;
    const page = findPage(route.name);
    const d = DEVICES[route.device];
    return (
        <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width: d.width, height: d.height }}>
            <SafeAreaInsetsContext.Provider value={d.insets}>
                <ScrollView
                    style={styles.root}
                    contentContainerStyle={[
                        styles.content,
                        { paddingTop: d.insets.top + 8, paddingBottom: d.insets.bottom + 24 },
                    ]}
                >
                    {page?.stories.map((entry) => (
                        <Fragment key={entry.component}>
                            {page.stories.length > 1 && !route.only ? (
                                <Text style={styles.component}>{entry.component}</Text>
                            ) : null}
                            {entry.examples
                                .filter((ex) => !route.only || ex.key === route.example)
                                .map((ex) => (
                                    <View key={ex.key} nativeID={ex.key} style={styles.example}>
                                        <Text style={styles.title}>{ex.title}</Text>
                                        <Backdrop backdrop={ex.backdrop}>
                                            <Rendered
                                                entry={entry}
                                                example={ex}
                                                kit={mobileKit}
                                                ui={ui}
                                                values={
                                                    ex === entry.examples[0]
                                                        ? values[entry.component]
                                                        : undefined
                                                }
                                            />
                                        </Backdrop>
                                    </View>
                                ))}
                        </Fragment>
                    ))}
                </ScrollView>
            </SafeAreaInsetsContext.Provider>
        </SafeAreaFrameContext.Provider>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 16, gap: 20 },
    component: { color: c.ink, fontSize: 18, fontWeight: "700", marginTop: 8 },
    example: { gap: 8 },
    title: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
});
