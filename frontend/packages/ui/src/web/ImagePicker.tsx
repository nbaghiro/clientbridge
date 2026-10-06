import type { ImagePickerProps } from "@clientbridge/app-core/public";
import { cssVar, tint } from "@clientbridge/tokens";
import { useState } from "react";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function ImagePicker({
    src,
    name,
    color,
    label,
    hint,
    onPick,
    onRemove,
    removeLabel,
    busy = false,
    size = "md",
    className,
}: WebProps<ImagePickerProps>) {
    const [over, setOver] = useState(false);
    const box = size === "lg" ? "h-48 w-48" : "h-24 w-24";
    const tone = color ?? cssVar("accent");
    return (
        <div
            className={cx(
                size === "lg" ? "flex flex-col items-start gap-2" : "flex items-center gap-4",
                className,
            )}
        >
            <button
                type="button"
                onClick={onPick}
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => {
                    setOver(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    onPick();
                }}
                aria-label={label}
                aria-busy={busy || undefined}
                className={`group relative shrink-0 overflow-hidden rounded-lg border transition ${box} ${
                    src === null
                        ? `border-dashed ${over ? "border-accent bg-accent-weak" : "border-line bg-bg hover:border-accent-line"}`
                        : "border-line"
                }`}
            >
                {src !== null ? (
                    <>
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-ink/55 py-1.5 text-center text-xs font-medium text-surface opacity-0 transition group-hover:opacity-100">
                            {label}
                        </span>
                    </>
                ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
                        <span
                            className="flex h-10 w-10 items-center justify-center rounded-full"
                            style={{ backgroundColor: tint(tone, 12), color: tone }}
                        >
                            <Icon name={busy ? "refresh" : "image"} size={20} />
                        </span>
                        <span className="text-xs font-semibold text-ink">{label}</span>
                        {size === "lg" && hint !== undefined ? (
                            <span className="text-[11px] leading-snug text-muted">{hint}</span>
                        ) : null}
                    </span>
                )}
                <span className="sr-only">{name}</span>
            </button>
            {size === "md" || src !== null ? (
                <div className="min-w-0 text-sm">
                    {size === "md" ? <p className="font-medium text-ink">{label}</p> : null}
                    {size === "md" && hint !== undefined ? (
                        <p className="mt-0.5 text-xs text-muted">{hint}</p>
                    ) : null}
                    {src !== null && onRemove !== undefined ? (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="mt-1 text-xs font-medium text-danger hover:underline"
                        >
                            {removeLabel}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
