import { type ModalProps, strings } from "@clientbridge/app-core";
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

export function Modal({
    open = true,
    onClose,
    size = "md",
    framed = true,
    children,
    style,
}: NativeProps<ModalProps>) {
    return (
        <NativeModal
            style={style}
            visible={open}
            transparent
            animationType="slide"
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
                            framed && styles.surface,
                        ]}
                        onStartShouldSetResponder={() => true}
                    >
                        {framed ? (
                            <ScrollView
                                style={styles.scroll}
                                contentContainerStyle={styles.framed}
                                keyboardShouldPersistTaps="handled"
                            >
                                {children}
                            </ScrollView>
                        ) : (
                            children
                        )}
                    </View>
                </View>
            </KeyboardAvoidingView>
        </NativeModal>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
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
