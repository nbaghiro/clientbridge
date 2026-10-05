import type { EmptyProps } from "@clientbridge/app-core/public";

export function Empty({ message }: EmptyProps) {
    return <p className="px-4 py-12 text-center text-sm text-muted">{message}</p>;
}
