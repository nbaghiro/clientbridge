import { PHOTO_WIDTHS, PHOTOS, type PhotoName, photoUrl } from "../content/photos";

const srcSet = (name: PhotoName, ext: string): string =>
    PHOTO_WIDTHS.map((w) => `${photoUrl(name, w, ext)} ${String(w)}w`).join(", ");

/** A stock photo as AVIF/WebP with a JPEG fallback. Only the hero photo should load eagerly. */
export function Photo({
    name,
    alt,
    sizes,
    position,
    priority = false,
}: {
    name: PhotoName;
    alt: string;
    sizes: string;
    position?: string;
    priority?: boolean;
}) {
    const { width, height } = PHOTOS[name];
    return (
        <picture>
            <source type="image/avif" srcSet={srcSet(name, "avif")} sizes={sizes} />
            <source type="image/webp" srcSet={srcSet(name, "webp")} sizes={sizes} />
            <img
                src={photoUrl(name, 960, "jpg")}
                srcSet={srcSet(name, "jpg")}
                sizes={sizes}
                alt={alt}
                width={width}
                height={height}
                loading={priority ? "eager" : "lazy"}
                decoding={priority ? "sync" : "async"}
                fetchPriority={priority ? "high" : "auto"}
                style={position ? { objectPosition: position } : undefined}
            />
        </picture>
    );
}
