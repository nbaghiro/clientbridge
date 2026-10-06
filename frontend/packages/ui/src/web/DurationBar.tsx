import { type DurationBarProps, type DurationSegment } from "@clientbridge/app-core/public";
import { cssVar, tint } from "@clientbridge/tokens";

export function DurationBar({ segments, color, caption }: DurationBarProps) {
    const tone = color ?? cssVar("accent");
    const shown = segments.filter((seg) => seg.minutes > 0);
    return (
        <figure>
            <div
                className="flex h-10 gap-0.5 overflow-hidden rounded-md"
                role="img"
                aria-label={caption}
            >
                {shown.map((seg: DurationSegment) => (
                    <div
                        key={seg.key}
                        style={
                            seg.kind === "main"
                                ? {
                                      flexGrow: seg.minutes,
                                      backgroundColor: tint(tone, 15),
                                      borderLeft: `3px solid ${tone}`,
                                  }
                                : {
                                      flexGrow: seg.minutes,
                                      backgroundImage:
                                          "repeating-linear-gradient(135deg, var(--border) 0 1.5px, transparent 1.5px 7px)",
                                  }
                        }
                        className={`flex min-w-[52px] items-center px-2 ${seg.kind === "main" ? "" : "bg-bg"}`}
                    >
                        <span
                            className="truncate text-xs font-semibold"
                            style={seg.kind === "main" ? { color: tone } : undefined}
                        >
                            {seg.kind === "main" ? (
                                seg.label
                            ) : (
                                <span className="text-muted">{seg.label}</span>
                            )}
                        </span>
                    </div>
                ))}
            </div>
            {caption !== undefined ? (
                <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
            ) : null}
        </figure>
    );
}
