import { type UploadTarget, useFileUpload } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;

export interface PickedFile {
    blob: Blob;
    contentType: string;
    sizeBytes?: number;
    name?: string;
}

/** Reusable file-upload control. The image/file picker is the only platform seam: inject `pickFile`
 *  (e.g. expo-image-picker → fetch(uri).then((r) => r.blob())) to wire it; undefined → a disabled
 *  placeholder (mirrors PurchaseConfirmPanel). #36 supplies the picker for contract signatures and
 *  form file fields. */
export function FileUploadField({
    target,
    label = "Upload file",
    pickFile,
    onUploaded,
}: {
    target: UploadTarget;
    label?: string;
    pickFile?: () => Promise<PickedFile | null>;
    onUploaded?: (fileId: string) => void;
}) {
    const { busy, error, fileId, upload } = useFileUpload(api, onUploaded);

    const run = (): void => {
        if (pickFile === undefined) return;
        void pickFile().then((picked) => {
            if (picked === null) return;
            upload(picked.blob, target, picked.contentType, picked.sizeBytes);
        });
    };

    const disabled = pickFile === undefined || busy;

    return (
        <View style={styles.box}>
            <Pressable
                style={[styles.btn, disabled && styles.disabled]}
                disabled={disabled}
                onPress={run}
            >
                {busy ? (
                    <ActivityIndicator color={c.inkSoft} />
                ) : (
                    <Text style={styles.btnText}>{label}</Text>
                )}
            </Pressable>
            {pickFile === undefined ? (
                <Text style={styles.note}>File picker not wired in this build.</Text>
            ) : null}
            {fileId !== null ? <Text style={styles.ok}>Uploaded.</Text> : null}
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 6 },
    btn: {
        alignItems: "center",
        paddingVertical: 11,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    btnText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    disabled: { opacity: 0.5 },
    note: { color: c.muted, fontSize: 12 },
    ok: { color: c.okFg, fontSize: 13, fontWeight: "600" },
    error: { color: c.danFg, fontSize: 13 },
});
