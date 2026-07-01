import { type IconName, type IconPrimitive, ICON_SPECS } from "@clientbridge/app-core";
import type { ReactNode } from "react";

function prims(name: IconName): ReactNode {
    return ICON_SPECS[name].map((p: IconPrimitive, i) => {
        if (p.kind === "rect")
            return <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} />;
        if (p.kind === "circle") return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />;
        return <path key={i} d={p.d} />;
    });
}

function Icon({ name, className }: { name: IconName; className?: string | undefined }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            {prims(name)}
        </svg>
    );
}

export const IconToday = ({ className }: { className?: string }) => (
    <Icon name="today" className={className} />
);
export const IconCalendar = ({ className }: { className?: string }) => (
    <Icon name="calendar" className={className} />
);
export const IconClients = ({ className }: { className?: string }) => (
    <Icon name="clients" className={className} />
);
export const IconInvoices = ({ className }: { className?: string }) => (
    <Icon name="invoices" className={className} />
);
export const IconInbox = ({ className }: { className?: string }) => (
    <Icon name="inbox" className={className} />
);
export const IconCatalog = ({ className }: { className?: string }) => (
    <Icon name="catalog" className={className} />
);
export const IconPlus = ({ className }: { className?: string }) => (
    <Icon name="plus" className={className} />
);
export const IconSearch = ({ className }: { className?: string }) => (
    <Icon name="search" className={className} />
);
export const IconPos = ({ className }: { className?: string }) => (
    <Icon name="pos" className={className} />
);
export const IconReports = ({ className }: { className?: string }) => (
    <Icon name="reports" className={className} />
);
export const IconPayouts = ({ className }: { className?: string }) => (
    <Icon name="payouts" className={className} />
);
export const IconReviews = ({ className }: { className?: string }) => (
    <Icon name="reviews" className={className} />
);
export const IconGift = ({ className }: { className?: string }) => (
    <Icon name="gift" className={className} />
);
export const IconLogout = ({ className }: { className?: string }) => (
    <Icon name="logout" className={className} />
);
export const IconSettings = ({ className }: { className?: string }) => (
    <Icon name="settings" className={className} />
);

export function Logo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" fill="none" className={className} aria-label="Clientbridge">
            <path
                d="M10 23a6 6 0 0 1 12 0"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
            />
            <path
                d="M5.5 23a10.5 10.5 0 0 1 21 0"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
            />
            <circle cx="16" cy="23" r="1.9" fill="currentColor" />
        </svg>
    );
}

export function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#4285F4"
                d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2.01 3.44-4.97 3.44-8.39z"
            />
            <path
                fill="#34A853"
                d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.75H1.71v2.98A12 12 0 0 0 12 24z"
            />
            <path
                fill="#FBBC05"
                d="M5.55 14.67a7.2 7.2 0 0 1 0-4.6V7.09H1.71a12 12 0 0 0 0 10.56l3.84-2.98z"
            />
            <path
                fill="#EA4335"
                d="M12 4.77c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.2 15.11 0 12 0A12 12 0 0 0 1.71 7.09l3.84 2.98C6.46 7.35 9 4.77 12 4.77z"
            />
        </svg>
    );
}
