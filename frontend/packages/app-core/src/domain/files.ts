import type { OptionMedia } from "../ui";
import { useEffect, useMemo, useState } from "react";

import { isConnectionFailure, useAsyncAction, useBusinessQuery } from "../hooks";
import { strings } from "../strings";
import { isManager } from "./auth";
import type { ApiLike } from "../api";

/** Where a file attaches. The server mints the row + s3 key; (parent_type, parent_id) own it. */
interface UploadTarget {
    parentType: string;
    parentId: string;
    purpose?: string;
}

interface FileUploadResponse {
    file: { id: string };
    upload_url: string;
}

/** Mint a file row + a short-lived presigned PUT url (`POST /v1/files`). The s3 key is server-side. */
function requestUpload(
    api: ApiLike,
    target: UploadTarget,
    contentType: string,
    sizeBytes?: number,
): Promise<{ fileId: string; uploadUrl: string }> {
    return api
        .post<FileUploadResponse>("/v1/files", {
            parent_type: target.parentType,
            parent_id: target.parentId,
            purpose: target.purpose ?? null,
            content_type: contentType,
            size: sizeBytes ?? null,
        })
        .then((r) => ({ fileId: r.file.id, uploadUrl: r.upload_url }));
}

/** Bypasses ApiLike: the presigned url is external and unauthenticated. */
async function putToPresignedUrl(
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

let mediaBase: string | null = null;

/** Set once at startup, so view-models can give option pictures a link without the API address. */
export function setMediaBase(apiBase: string): void {
    mediaBase = apiBase;
}

function mediaSrc(fileId: string | null): string | null {
    return mediaBase === null ? null : mediaUrl(mediaBase, fileId);
}

export function personMedia(
    name: string,
    color: string | null = null,
    src: string | null = null,
): OptionMedia {
    return { kind: "person", name, color, src };
}

export function itemMedia(item: {
    name: string;
    color: string | null;
    image_file_id: string | null;
}): OptionMedia {
    return { kind: "item", name: item.name, color: item.color, src: mediaSrc(item.image_file_id) };
}

/** The stable public link for a business logo or item image (`GET /media/{id}` on the API). */
export function mediaUrl(apiBase: string, fileId: string | null): string | null {
    return fileId === null ? null : `${apiBase.replace(/\/$/, "")}/media/${fileId}`;
}

/** A private photo and its download link, once loaded. */
export interface Photo {
    id: string;
    src: string | null;
}

export function bookingPhotoTarget(bookingId: string): UploadTarget {
    return { parentType: "booking", parentId: bookingId, purpose: "photo" };
}

// presigned links last an hour on the API, so a cached one is refreshed well before it lapses
const LINK_TTL_MS = 30 * 60_000;
const links = new Map<string, { url: string; at: number }>();

/** Download links for private photos, by file id; a file appears once its link has loaded. */
export function useFileLinks(
    api: ApiLike | null,
    fileIds: readonly string[],
): Record<string, string> {
    const key = fileIds.join(",");
    const ids = useMemo(() => (key === "" ? [] : key.split(",")), [key]);
    const [, setLoaded] = useState(0);
    useEffect(() => {
        let live = true;
        const now = Date.now();
        if (api === null) return;
        const missing = ids.filter((id) => {
            const cached = links.get(id);
            return cached === undefined || now - cached.at > LINK_TTL_MS;
        });
        if (missing.length === 0) return;
        Promise.all(
            missing.map((id) =>
                api
                    .get<{ url: string }>(`/v1/files/${id}/link`)
                    .then((r) => {
                        links.set(id, { url: r.url, at: Date.now() });
                    })
                    .catch(() => undefined),
            ),
        )
            .then(() => {
                if (live) setLoaded((n) => n + 1);
            })
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [api, ids]);
    return Object.fromEntries(
        ids.flatMap((id) => {
            const cached = links.get(id);
            return cached === undefined ? [] : [[id, cached.url] as const];
        }),
    );
}

export function logoTarget(businessId: string): UploadTarget {
    return { parentType: "business", parentId: businessId, purpose: "logo" };
}

export function coverTarget(businessId: string): UploadTarget {
    return { parentType: "business", parentId: businessId, purpose: "image" };
}

interface FileUpload {
    busy: boolean;
    error: string | null;
    fileId: string | null;
    upload: (body: Blob, target: UploadTarget, contentType: string, sizeBytes?: number) => void;
    reset: () => void;
}

/** The only platform seam is the blob source (web input, mobile picker). */
export function useFileUpload(api: ApiLike, onUploaded?: (fileId: string) => void): FileUpload {
    const [fileId, setFileId] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const upload = (
        body: Blob,
        target: UploadTarget,
        contentType: string,
        sizeBytes?: number,
    ): void => {
        run(
            async () => {
                const { fileId: id, uploadUrl } = await requestUpload(
                    api,
                    target,
                    contentType,
                    sizeBytes,
                );
                await putToPresignedUrl(uploadUrl, body, contentType);
                // the server confirms the bytes arrived before the file counts as attached
                await api.post(`/v1/files/${id}/complete`, {});
                setFileId(id);
                onUploaded?.(id);
            },
            {
                errorMessage: (error) =>
                    isConnectionFailure(error)
                        ? strings.common.fileUploadOffline
                        : strings.common.fileUploadError,
            },
        );
    };

    const reset = (): void => {
        setFileId(null);
        setError(null);
    };

    return { busy, error, fileId, upload, reset };
}

export const PEOPLE_PHOTOS_SQL = `
SELECT f.id, f.parent_type, f.parent_id, s.id AS staff_id
FROM files f
LEFT JOIN staff s ON f.parent_type = 'user' AND s.user_id = f.parent_id
WHERE f.parent_type IN ('client', 'user') AND f.purpose = 'photo' AND f.uploaded_at IS NOT NULL
ORDER BY f.created_at, f.id`;

interface PeoplePhotoRow {
    id: string;
    parent_type: string;
    parent_id: string;
    staff_id: string | null;
}

interface PhotoIndex {
    clients: ReadonlyMap<string, string>;
    users: ReadonlyMap<string, string>;
    staff: ReadonlyMap<string, string>;
}

/** Each client's, user's and staff member's newest photo file; rows come oldest first. */
export function photoIndex(rows: readonly PeoplePhotoRow[]): PhotoIndex {
    const clients = new Map<string, string>();
    const users = new Map<string, string>();
    const staff = new Map<string, string>();
    for (const row of rows) {
        if (row.parent_type === "client") clients.set(row.parent_id, row.id);
        if (row.parent_type !== "user") continue;
        users.set(row.parent_id, row.id);
        if (row.staff_id !== null) staff.set(row.staff_id, row.id);
    }
    return { clients, users, staff };
}

type PhotoOf = (id: string | null | undefined) => string | null;

interface PeoplePhotos {
    client: PhotoOf;
    user: PhotoOf;
    staff: PhotoOf;
}

let photoApi: ApiLike | null = null;

/** Set once at startup, so any view-model can show people's photos without being handed the API. */
export function setPhotoApi(api: ApiLike): void {
    photoApi = api;
}

/** The photo link for any client, user or staff member on screen; null until it loads. */
export function usePeoplePhotos(): PeoplePhotos {
    const rows = useBusinessQuery<PeoplePhotoRow>(PEOPLE_PHOTOS_SQL).data;
    const index = useMemo(() => photoIndex(rows), [rows]);
    const links = useFileLinks(photoApi, [
        ...new Set([...index.clients.values(), ...index.users.values()]),
    ]);
    const of =
        (map: ReadonlyMap<string, string>): PhotoOf =>
        (id) => {
            const file = id == null ? undefined : map.get(id);
            return file === undefined ? null : (links[file] ?? null);
        };
    return { client: of(index.clients), user: of(index.users), staff: of(index.staff) };
}

export type PhotoOwner = { kind: "client"; id: string } | { kind: "user"; id: string };

/** Who may change a photo: any member for a client, the person or a manager for a user. */
export function canEditPhoto(
    owner: PhotoOwner,
    viewer: { userId: string | null; role: string | null },
): boolean {
    if (viewer.role === null) return false;
    if (owner.kind === "client") return true;
    return owner.id === viewer.userId || isManager(viewer.role);
}

export interface PersonPhoto {
    src: string | null;
    canEdit: boolean;
    busy: boolean;
    error: string | null;
    label: string;
    hint: string;
    removeLabel: string;
    upload: (body: Blob, contentType: string, sizeBytes?: number) => void;
    remove: () => void;
}

/** Set, change or remove the photo of a client or a team member. */
export function usePersonPhoto(
    api: ApiLike,
    owner: PhotoOwner,
    viewer: { userId: string | null; role: string | null },
): PersonPhoto {
    const photos = usePeoplePhotos();
    const files = useFileUpload(api);
    const removal = useAsyncAction();
    const src = owner.kind === "client" ? photos.client(owner.id) : photos.user(owner.id);
    const canEdit = canEditPhoto(owner, viewer);
    const f = strings.files;
    return {
        src,
        canEdit,
        busy: files.busy || removal.busy,
        error: files.error ?? removal.error,
        label: src === null ? f.addPhoto : f.changePhoto,
        hint: owner.kind === "client" ? f.clientPhotoHint : f.memberPhotoHint,
        removeLabel: f.removePhoto,
        upload: (body, contentType, sizeBytes) => {
            if (!canEdit) return;
            files.upload(
                body,
                { parentType: owner.kind, parentId: owner.id, purpose: "photo" },
                contentType,
                sizeBytes,
            );
        },
        remove: () => {
            if (!canEdit) return;
            removal.run(() => api.delete(`/v1/files/photos/${owner.kind}/${owner.id}`), {
                errorMessage: (error) =>
                    isConnectionFailure(error) ? f.removePhotoOffline : f.removePhotoError,
            });
        },
    };
}
