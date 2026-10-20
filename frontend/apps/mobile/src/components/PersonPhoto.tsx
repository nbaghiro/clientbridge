import { type PhotoOwner, strings, useAsyncAction, usePersonPhoto } from "@clientbridge/app-core";
import { DetailSection, ImagePicker, Notice } from "@clientbridge/ui";
import { launchImageLibraryAsync } from "expo-image-picker";
import { View } from "react-native";

import { api } from "../lib/api";
import { useUserId, useViewer } from "../lib/auth";

/** A client's or team member's photo, picked from the library and removable by whoever may change it. */
export function PersonPhoto({
    owner,
    name,
    color,
}: {
    owner: PhotoOwner;
    name: string;
    color?: string | null | undefined;
}) {
    const role = useViewer()?.role ?? null;
    const photo = usePersonPhoto(api, owner, { userId: useUserId(), role });
    const picker = useAsyncAction();
    if (!photo.canEdit) return null;
    const pick = (): void => {
        picker.run(
            async () => {
                const result = await launchImageLibraryAsync({
                    mediaTypes: ["images"],
                    allowsEditing: true,
                    aspect: [1, 1],
                    quality: 0.85,
                });
                const asset = result.assets?.[0];
                if (!asset) return;
                const blob = await (await fetch(asset.uri)).blob();
                photo.upload(blob, asset.mimeType ?? "image/jpeg", asset.fileSize);
            },
            { errorMessage: strings.common.fileUploadError },
        );
    };
    const error = photo.error ?? picker.error;
    return (
        <DetailSection title={strings.files.photo}>
            <View style={{ gap: 12 }}>
                <ImagePicker
                    src={photo.src}
                    name={name}
                    color={color}
                    label={photo.label}
                    hint={photo.hint}
                    busy={photo.busy || picker.busy}
                    onPick={pick}
                    onRemove={photo.remove}
                    removeLabel={photo.removeLabel}
                />
                {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            </View>
        </DetailSection>
    );
}
