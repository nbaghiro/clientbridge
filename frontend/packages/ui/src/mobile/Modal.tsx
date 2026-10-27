import { type ModalProps, strings } from "@clientbridge/app-core";
import { createContext, useContext, useEffect, useRef } from "react";
import { theme } from "@clientbridge/tokens/native";
import {
    Animated,
    KeyboardAvoidingView,
    Modal as NativeModal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SidebarContext, useTabletLayout } from "./layout";
import { useModalLayer, useOverlay } from "./layers";
import type { NativeProps } from "./props";

const c = theme.colors;
const FlowContext = createContext(false);
export function useModalFlow(): boolean {
    return useContext(FlowContext);
}

export function Modal({
    open = true,
    flow = false,
    variant = "dialog",
    onClose,
    size = "md",
    framed = true,
    children,
    style,
}: NativeProps<ModalProps>) {
    const inFlow = useModalFlow();
    const top = useModalLayer(open && !inFlow);
    const overlay = useOverlay();
    const tablet = useTabletLayout();
    const insets = useSafeAreaInsets();
    // Records, editors and flows slide in from the right on a tablet, like the web drawers.
    const panel = tablet && (variant === "drawer" || flow || size === "xl");
    const slide = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!open || !panel) return;
        slide.setValue(0);
        Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }, [open, panel, slide]);
    const content = framed ? (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.framed}
            keyboardShouldPersistTaps="handled"
        >
            {children}
        </ScrollView>
    ) : (
        children
    );
    if (inFlow)
        return (
            <View
                style={[open ? styles.flowPage : styles.hidden, style]}
                pointerEvents={open ? "auto" : "none"}
                accessibilityElementsHidden={!open}
                importantForAccessibility={open ? "auto" : "no-hide-descendants"}
            >
                {content}
            </View>
        );
    return (
        <NativeModal
            style={style}
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <SidebarContext.Provider value={null}>
                <KeyboardAvoidingView
                    style={styles.fill}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <View
                        style={[
                            styles.backdrop,
                            panel ? styles.docked : tablet ? styles.centred : null,
                        ]}
                        accessibilityViewIsModal
                    >
                        <Pressable
                            style={StyleSheet.absoluteFill}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel={strings.common.close}
                        />
                        {panel ? (
                            <Animated.View
                                style={[
                                    styles.panel,
                                    { paddingTop: insets.top, paddingBottom: insets.bottom },
                                    {
                                        transform: [
                                            {
                                                translateX: slide.interpolate({
                                                    inputRange: [0, 1],
                                                    outputRange: [48, 0],
                                                }),
                                            },
                                        ],
                                    },
                                ]}
                            >
                                <FlowContext.Provider value={flow}>{content}</FlowContext.Provider>
                            </Animated.View>
                        ) : (
                            <View
                                style={[
                                    styles.sheet,
                                    tablet && styles.card,
                                    size === "xl" && styles.tall,
                                    (framed || flow) && styles.surface,
                                ]}
                            >
                                <FlowContext.Provider value={flow}>{content}</FlowContext.Provider>
                            </View>
                        )}
                    </View>
                </KeyboardAvoidingView>
                {top ? overlay : null}
            </SidebarContext.Provider>
        </NativeModal>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
    flowPage: { flex: 1, minHeight: 0 },
    hidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
    sheet: {
        maxHeight: "88%",
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        overflow: "hidden",
    },
    centred: { justifyContent: "center", alignItems: "center", padding: theme.layout.gutter },
    card: { width: "100%", maxWidth: theme.layout.sheet, borderRadius: 18 },
    docked: { flexDirection: "row", justifyContent: "flex-end" },
    panel: {
        height: "100%",
        width: "100%",
        maxWidth: theme.layout.panel,
        backgroundColor: c.surface,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: c.border,
    },
    tall: { height: "86%" },
    surface: { backgroundColor: c.surface },
    scroll: { flexGrow: 0, flexShrink: 1 },
    framed: { padding: 22, paddingBottom: 36 },
});
