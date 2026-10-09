import { type ModalProps, strings } from "@clientbridge/app-core";
import { createContext, useContext } from "react";
import { theme } from "@clientbridge/tokens/native";
import {
    KeyboardAvoidingView,
    Modal as NativeModal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;
const FlowContext = createContext(false);
export function useModalFlow(): boolean {
    return useContext(FlowContext);
}

export function Modal({
    open = true,
    flow = false,
    onClose,
    size = "md",
    framed = true,
    children,
    style,
}: NativeProps<ModalProps>) {
    const inFlow = useModalFlow();
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
            <KeyboardAvoidingView
                style={styles.fill}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <View style={styles.backdrop} accessibilityViewIsModal>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel={strings.common.close}
                    />
                    <View
                        style={[
                            styles.sheet,
                            size === "xl" && styles.tall,
                            (framed || flow) && styles.surface,
                        ]}
                    >
                        <FlowContext.Provider value={flow}>{content}</FlowContext.Provider>
                    </View>
                </View>
            </KeyboardAvoidingView>
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
    tall: { height: "86%" },
    surface: { backgroundColor: c.surface },
    scroll: { flexGrow: 0, flexShrink: 1 },
    framed: { padding: 22, paddingBottom: 36 },
});
