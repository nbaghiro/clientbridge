import { type UploadTarget, strings, useFileUpload } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Notice } from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;

export interface PickedFile {
    blob: Blob;
    contentType: string;
    sizeBytes?: number;
    name?: string;
}

/** The file picker is the only platform seam: without `pickFile` the control renders disabled. */
export function FileUploadField({
    target,
    label = strings.files.uploadFile,
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
        pickFile()
            .then((picked) => {
                if (picked === null) return;
                upload(picked.blob, target, picked.contentType, picked.sizeBytes);
            })
            .catch(() => undefined);
    };

    return (
        <View style={styles.box}>
            <Button
                variant="outline"
                full
                disabled={pickFile === undefined}
                busy={busy}
                onPress={run}
            >
                {label}
            </Button>
            {pickFile === undefined ? (
                <Text style={styles.note}>{strings.files.pickerNotWired}</Text>
            ) : null}
            {fileId !== null ? <Notice tone="success">{strings.files.uploaded}</Notice> : null}
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 6 },
    note: { color: c.muted, fontSize: 12 },
});
