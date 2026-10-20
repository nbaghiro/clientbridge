import { type PhotoOwner, strings, usePersonPhoto } from "@clientbridge/app-core";
import { DetailSection, ImagePicker, Notice } from "@clientbridge/ui";
import { type ChangeEvent, useRef } from "react";

import { api } from "../lib/api";
import { getUserId, useViewer } from "../lib/auth";

/** A client's or team member's photo, picked from a file and removable by whoever may change it. */
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
    const photo = usePersonPhoto(api, owner, { userId: getUserId(), role });
    const input = useRef<HTMLInputElement>(null);
    if (!photo.canEdit) return null;
    const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file !== undefined) photo.upload(file, file.type || "image/jpeg", file.size);
        e.target.value = "";
    };
    return (
        <DetailSection title={strings.files.photo}>
            <div className="space-y-2">
                <ImagePicker
                    src={photo.src}
                    name={name}
                    color={color}
                    label={photo.label}
                    hint={photo.hint}
                    busy={photo.busy}
                    onPick={() => {
                        input.current?.click();
                    }}
                    onRemove={photo.remove}
                    removeLabel={photo.removeLabel}
                />
                <input
                    ref={input}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={onFile}
                    className="hidden"
                />
                {photo.error !== null ? <Notice tone="danger">{photo.error}</Notice> : null}
            </div>
        </DetailSection>
    );
}
