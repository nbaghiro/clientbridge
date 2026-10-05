import { LOGO, strings } from "@clientbridge/app-core/public";

export interface LogoProps {
    className?: string;
    height?: string;
}

export function Logo({ className, height }: LogoProps) {
    return (
        <svg
            viewBox={LOGO.viewBox}
            fill="none"
            stroke="currentColor"
            strokeWidth={LOGO.strokeWidth}
            strokeLinecap="round"
            className={className}
            style={{ aspectRatio: LOGO.aspect, height }}
            aria-hidden="true"
        >
            {LOGO.paths.map((d) => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}

/** The mark beside the wordmark, sized from the wordmark's font size (see LOGO in app-core). */
export function Lockup({
    className,
    markClassName = "text-accent",
}: {
    className?: string;
    markClassName?: string;
}) {
    return (
        <span
            className={`flex items-center font-bold tracking-tight ${className ?? ""}`}
            style={{ gap: LOGO.gap }}
        >
            <Logo
                className={`w-auto ${markClassName}`}
                height={`${String(LOGO.heightPerFontSize)}em`}
            />
            <span>{strings.common.appName}</span>
        </span>
    );
}
