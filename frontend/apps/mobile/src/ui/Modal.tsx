import { type ModalProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Modal as NativeModal, Pressable, StyleSheet, View } from "react-native";

const c = theme.colors;

export function Modal({ open = true, onClose, size = "md", framed = true, children }: ModalProps) {
    return (
        <NativeModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable
                style={styles.backdrop}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
            >
                <View
                    style={[styles.sheet, size === "xl" && styles.tall, framed && styles.framed]}
                    onStartShouldSetResponder={() => true}
                    accessibilityViewIsModal
                >
                    {children}
                </View>
            </Pressable>
        </NativeModal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
    sheet: {
        maxHeight: "88%",
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        overflow: "hidden",
    },
    tall: { height: "86%" },
    framed: { backgroundColor: c.surface, padding: 22, paddingBottom: 36 },
});
