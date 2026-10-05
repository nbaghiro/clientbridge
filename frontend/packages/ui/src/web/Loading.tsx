import { type LoadingProps, strings } from "@clientbridge/app-core/public";

export function Loading({ label, inline = false }: LoadingProps) {
    return (
        <p role="status" className={`text-sm text-muted ${inline ? "" : "px-4 py-10 text-center"}`}>
            {label ?? strings.common.loading}
        </p>
    );
}
