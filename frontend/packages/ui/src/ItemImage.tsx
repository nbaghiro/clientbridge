import { useState } from "react";

export interface ItemImageProps {
    src: string | null;
    name: string;
    color?: string | null | undefined;
    size?: number | undefined;
}

/** An item's picture, or its initial on a tint of its colour when there's none (or it fails). */
export function ItemImage({ src, name, color, size = 40 }: ItemImageProps) {
    const [failed, setFailed] = useState(false);
    const box = { width: size, height: size };
    if (src !== null && !failed) {
        return (
            <img
                src={src}
                alt=""
                style={box}
                onError={() => {
                    setFailed(true);
                }}
                className="shrink-0 rounded-md object-cover"
            />
        );
    }
    const tone = color ?? "#3F5E80";
    return (
        <span
            aria-hidden
            style={{ ...box, backgroundColor: `${tone}1f`, color: tone, fontSize: size * 0.42 }}
            className="flex shrink-0 items-center justify-center rounded-md font-semibold"
        >
            {name.trim().charAt(0).toUpperCase()}
        </span>
    );
}
