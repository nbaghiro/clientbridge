import { type CopyFieldProps, strings, useFlash } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { type WebProps, cx } from "./props";

export function CopyField({
    label,
    value,
    hint,
    variant = "line",
    copied: copiedProp,
    onCopy,
    copyLabel = strings.ui.copy,
    copiedLabel = strings.ui.copied,
    className,
}: WebProps<CopyFieldProps>) {
    const [flashed, flash] = useFlash();
    const copied = copiedProp ?? flashed;
    const copy = (): void => {
        if (copiedProp === undefined) {
            navigator.clipboard.writeText(value).then(flash, () => undefined);
        }
        onCopy?.();
    };
    const button = (
        <Button
            size="sm"
            variant={copied && variant !== "snippet" ? "quiet" : "outline"}
            onPress={copy}
            icon={copied ? "check" : "copy"}
        >
            {copied ? copiedLabel : copyLabel}
        </Button>
    );
    return (
        <div className={className}>
            <div className="mb-1.5 flex items-end justify-between gap-3">
                <span className="text-sm font-medium text-ink-soft">{label}</span>
                {variant === "snippet" ? button : null}
            </div>
            {variant === "snippet" ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
                    {value}
                </pre>
            ) : (
                <div className="flex items-center gap-2 rounded-md border border-line bg-bg py-1 pl-3 pr-1">
                    <span
                        className={cx(
                            "min-w-0 flex-1 truncate font-mono text-ink",
                            variant === "code"
                                ? "py-1 text-xl font-semibold tracking-[0.12em]"
                                : "text-[13px]",
                        )}
                    >
                        {value}
                    </span>
                    {button}
                </div>
            )}
            {hint !== undefined ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
            <span role="status" className="sr-only">
                {copied ? copiedLabel : ""}
            </span>
        </div>
    );
}
