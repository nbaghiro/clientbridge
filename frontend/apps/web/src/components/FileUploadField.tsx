import { type UploadTarget, fileDownloadUrl, useFileUpload } from "@clientbridge/app-core";
import { type ChangeEvent, useRef, useState } from "react";

import { api } from "../lib/api";

/** Reusable file-upload control: pick a file → presigned PUT to S3 → yields the new `file_id` plus a
 *  download link. #36 (contract drawn-signature + form file fields) drops this in by passing the
 *  parent target. */
export function FileUploadField({
    target,
    accept,
    label = "Upload file",
    onUploaded,
}: {
    target: UploadTarget;
    accept?: string;
    label?: string;
    onUploaded?: (fileId: string) => void;
}) {
    const { busy, error, fileId, upload } = useFileUpload(api, onUploaded);
    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState<string | null>(null);

    const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file === undefined) return;
        setName(file.name);
        upload(file, target, file.type !== "" ? file.type : "application/octet-stream", file.size);
    };

    const openDownload = (): void => {
        if (fileId === null) return;
        void fileDownloadUrl(api, fileId).then((url) => {
            window.open(url, "_blank", "noopener");
        });
    };

    return (
        <div className="space-y-2">
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={onChange}
                className="hidden"
            />
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => {
                        inputRef.current?.click();
                    }}
                    disabled={busy}
                    className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                >
                    {busy ? "Uploading…" : label}
                </button>
                {name !== null ? <span className="truncate text-sm text-muted">{name}</span> : null}
            </div>
            {fileId !== null ? (
                <button
                    type="button"
                    onClick={openDownload}
                    className="text-sm font-medium text-accent hover:underline"
                >
                    View uploaded file
                </button>
            ) : null}
            {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
    );
}
