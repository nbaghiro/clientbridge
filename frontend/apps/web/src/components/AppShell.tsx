import { DESTINATIONS, type DestinationKey, strings } from "@clientbridge/app-core";
import type { ComponentType } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Lockup } from "@clientbridge/ui";

import {
    IconCalendar,
    IconClients,
    IconInbox,
    IconInvoices,
    IconLogout,
    IconSettings,
    IconToday,
} from "./icons";

const DESTINATION_WEB: Record<
    DestinationKey,
    { to: string; Icon: ComponentType<{ className?: string }> }
> = {
    today: { to: "/today", Icon: IconToday },
    schedule: { to: "/schedule", Icon: IconCalendar },
    clients: { to: "/clients", Icon: IconClients },
    payments: { to: "/payments", Icon: IconInvoices },
    inbox: { to: "/inbox", Icon: IconInbox },
};

const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
        isActive
            ? "bg-accent-weak font-semibold text-accent"
            : "font-medium text-ink-soft hover:bg-bg"
    }`;

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
    return (
        <div className="flex h-screen bg-bg text-ink">
            <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
                <Lockup className="px-5 pb-5 pt-6 text-lg" />

                <div className="border-b border-line" />

                <nav className="flex-1 space-y-1 px-3 py-4">
                    {DESTINATIONS.map(({ key, label }) => {
                        const { to, Icon } = DESTINATION_WEB[key];
                        return (
                            <NavLink key={key} to={to} className={linkClass}>
                                <Icon className="h-[18px] w-[18px]" />
                                {label}
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="space-y-1 border-t border-line p-3">
                    <NavLink to="/setup" className={linkClass}>
                        <IconSettings className="h-[18px] w-[18px]" />
                        {strings.nav.setup}
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
