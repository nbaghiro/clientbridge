import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";

/** Where a file attaches. The server mints the row + s3 key; (parent_type, parent_id) own it. */
export interface UploadTarget {
    parentType: string;
    parentId: string;
    kind?: string;
}

interface FileUploadResponse {
    file: { id: string };
    upload_url: string;
}

/** Mint a file row + a short-lived presigned PUT url (`POST /v1/files`). The s3 key is server-side. */
export function requestUpload(
    api: ApiLike,
    target: UploadTarget,
    contentType: string,
    sizeBytes?: number,
): Promise<{ fileId: string; uploadUrl: string }> {
    return api
        .post<FileUploadResponse>("/v1/files", {
            parent_type: target.parentType,
            parent_id: target.parentId,
            kind: target.kind ?? null,
            content_type: contentType,
            size: sizeBytes ?? null,
        })
        .then((r) => ({ fileId: r.file.id, uploadUrl: r.upload_url }));
}

/** PUT the bytes straight to the presigned S3 url — bypasses ApiLike (an external, unauthed url).
 *  `Blob` resolves per platform (web File/Blob, RN Blob); each one's fetch accepts its own Blob. */
export async function putToPresignedUrl(
    uploadUrl: string,
    body: Blob,
    contentType: string,
): Promise<void> {
    const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body,
    });
    if (!res.ok) {
        throw new Error(`upload failed (${res.status})`);
    }
}

/** A short-lived presigned download url for a stored file (`GET /v1/files/{id}/url`). */
export function fileDownloadUrl(api: ApiLike, fileId: string): Promise<string> {
    return api.get<{ url: string }>(`/v1/files/${fileId}/url`).then((r) => r.url);
}

export interface FileUpload {
    busy: boolean;
    error: string | null;
    fileId: string | null;
    upload: (body: Blob, target: UploadTarget, contentType: string, sizeBytes?: number) => void;
    reset: () => void;
}

/** Shared file-upload action: request a presigned url, PUT the platform's blob to it, then surface
 *  the new `file_id`. The only platform seam is the file/blob source (web input, mobile picker). */
export function useFileUpload(api: ApiLike, onUploaded?: (fileId: string) => void): FileUpload {
    const [fileId, setFileId] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const upload = (
        body: Blob,
        target: UploadTarget,
        contentType: string,
        sizeBytes?: number,
    ): void => {
        void run(
            async () => {
                const { fileId: id, uploadUrl } = await requestUpload(
                    api,
                    target,
                    contentType,
                    sizeBytes,
                );
                await putToPresignedUrl(uploadUrl, body, contentType);
                setFileId(id);
                onUploaded?.(id);
            },
            { errorMessage: "Couldn't upload that file. Please try again." },
        );
    };

    const reset = (): void => {
        setFileId(null);
        setError(null);
    };

    return { busy, error, fileId, upload, reset };
}
