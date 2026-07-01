import {
    MONEY_NAV_ITEMS,
    type MoneyNavKey,
    canManagePayments,
    strings,
} from "@clientbridge/app-core";
import type { ComponentType } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useRole } from "../lib/auth";
import {
    IconCalendar,
    IconClients,
    IconGift,
    IconInbox,
    IconInvoices,
    IconLogout,
    IconPayouts,
    IconPos,
    IconReports,
    IconReviews,
    IconSettings,
    IconToday,
    Logo,
} from "./icons";

// The per-platform routing + icon for each shared money destination (labels come from app-core).
const MONEY_WEB: Record<MoneyNavKey, { to: string; Icon: ComponentType<{ className?: string }> }> =
    {
        giftCards: { to: "/gift-cards", Icon: IconGift },
        payouts: { to: "/payouts", Icon: IconPayouts },
        reviews: { to: "/reviews", Icon: IconReviews },
        reports: { to: "/reports", Icon: IconReports },
    };

const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
        isActive
            ? "bg-accent-weak font-semibold text-accent"
            : "font-medium text-ink-soft hover:bg-bg"
    }`;

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
    const role = useRole();
    const nav = [
        { to: "/home", label: strings.nav.today, Icon: IconToday },
        { to: "/calendar", label: strings.nav.calendar, Icon: IconCalendar },
        { to: "/clients", label: strings.nav.clients, Icon: IconClients },
        { to: "/invoices", label: strings.nav.invoices, Icon: IconInvoices },
        { to: "/pos", label: strings.nav.pointOfSale, Icon: IconPos },
        // The money destinations are owner/admin-only (matches the backend gate + the mobile Home section).
        ...(canManagePayments(role)
            ? MONEY_NAV_ITEMS.map((m) => ({
                  to: MONEY_WEB[m.key].to,
                  label: m.label,
                  Icon: MONEY_WEB[m.key].Icon,
              }))
            : []),
        { to: "/inbox", label: strings.nav.inbox, Icon: IconInbox },
    ];

    return (
        <div className="flex h-screen bg-bg text-ink">
            <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
                <div className="flex items-center gap-2 px-5 pb-5 pt-6">
                    <Logo className="h-7 w-7 text-accent" />
                    <span className="text-lg font-bold tracking-tight">Clientbridge</span>
                </div>

                <div className="border-b border-line" />

                <nav className="flex-1 space-y-1 px-3 py-4">
                    {nav.map(({ to, label, Icon }) => (
                        <NavLink key={to} to={to} className={linkClass}>
                            <Icon className="h-[18px] w-[18px]" />
                            {label}
                        </NavLink>
                    ))}
                </nav>

                <div className="space-y-1 border-t border-line p-3">
                    <NavLink to="/settings" className={linkClass}>
                        <IconSettings className="h-[18px] w-[18px]" />
                        {strings.nav.settings}
                    </NavLink>
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-bg hover:text-ink-soft"
                    >
                        <IconLogout className="h-[18px] w-[18px]" />
                        {strings.nav.signOut}
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
