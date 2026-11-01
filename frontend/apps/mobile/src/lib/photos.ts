import type { ImagePickerAsset } from "expo-image-picker";

/** A picked photo's bytes; the global fetch streams text, which a local file can't be read as. */
export function pickedPhoto(asset: ImagePickerAsset): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onload = () => {
            resolve(request.response as Blob);
        };
        request.onerror = () => {
            reject(new TypeError("the picked photo could not be read"));
        };
        request.responseType = "blob";
        request.open("GET", asset.uri);
        request.send();
    });
}
