import { type UploadTarget, strings, useFileUpload } from "@clientbridge/app-core";
import { ItemImage, Notice } from "@clientbridge/ui";
import { type ChangeEvent, useRef } from "react";

import { api } from "../lib/api";

/** An image that its owner can click to replace; the new file syncs back in and takes over. */
export function ItemImageUpload({
    src,
    name,
    color,
    size,
    target,
}: {
    src: string | null;
    name: string;
    color?: string | null;
    size?: number;
    target: UploadTarget;
}) {
    const { busy, error, upload } = useFileUpload(api);
    const inputRef = useRef<HTMLInputElement>(null);

    const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file === undefined) return;
        upload(file, target, file.type !== "" ? file.type : "image/png", file.size);
        e.target.value = "";
    };

    return (
        <span className="inline-flex flex-col items-start gap-1">
            <button
                type="button"
                title={strings.files.changeImage}
                disabled={busy}
                onClick={() => {
                    inputRef.current?.click();
                }}
                className={`rounded-md transition hover:opacity-80 disabled:opacity-50 ${busy ? "animate-pulse" : ""}`}
            >
                <ItemImage src={src} name={name} color={color} size={size} />
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onChange}
                className="hidden"
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </span>
    );
}
