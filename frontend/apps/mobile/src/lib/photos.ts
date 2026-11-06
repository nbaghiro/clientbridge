import {
    type ImagePickerAsset,
    type ImagePickerOptions,
    type ImagePickerResult,
    launchImageLibraryAsync,
    UIImagePickerPreferredAssetRepresentationMode,
} from "expo-image-picker";

/** The phone's photo library; uploads take PNG, JPEG or WebP, so iOS hands a HEIC over as a JPEG. */
export function pickFromLibrary(options: ImagePickerOptions): Promise<ImagePickerResult> {
    return launchImageLibraryAsync({
        ...options,
        preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
}

/** A picked photo's bytes; the global fetch streams text, which a local file can't be read as. */
export function pickedPhoto(asset: ImagePickerAsset): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onload = () => {
            resolve(request.response as Blob);
        };
        // not a TypeError, which would read as being offline
        request.onerror = () => {
            reject(new Error("the picked photo could not be read"));
        };
        request.responseType = "blob";
        request.open("GET", asset.uri);
        request.send();
    });
}
