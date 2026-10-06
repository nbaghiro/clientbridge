import type { CopyFieldProps } from "@clientbridge/app-core/public";

import { Button } from "./Button";

import { Icon } from "./Icon";

/** A link or snippet to hand out, with a copy button that confirms in place. */
export function CopyField({
    label,
    value,
    hint,
    multiline = false,
    emphasis = "plain",
    copied,
    onCopy,
    copyLabel,
    copiedLabel,
}: CopyFieldProps) {
    return (
        <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
                <span className="text-sm font-medium text-ink-soft">{label}</span>
                {multiline ? (
                    <Button
                        size="sm"
                        variant="outline"
                        onPress={onCopy}
                        icon={<Icon name={copied ? "check" : "copy"} size={14} />}
                    >
                        {copied ? copiedLabel : copyLabel}
                    </Button>
                ) : null}
            </div>
            {multiline ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
                    {value}
                </pre>
            ) : (
                <div className="flex items-center gap-2 rounded-md border border-line bg-bg py-1 pl-3 pr-1">
                    <span
                        className={`min-w-0 flex-1 truncate font-mono text-ink ${emphasis === "code" ? "py-1 text-xl font-semibold tracking-[0.12em]" : "text-[13px]"}`}
                    >
                        {value}
                    </span>
                    <Button
                        size="sm"
                        variant={copied ? "quiet" : "outline"}
                        onPress={onCopy}
                        icon={<Icon name={copied ? "check" : "copy"} size={14} />}
                    >
                        {copied ? copiedLabel : copyLabel}
                    </Button>
                </div>
            )}
            {hint !== undefined ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
        </div>
    );
}
