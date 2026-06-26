import { NavLink, Outlet } from "react-router-dom";

import {
    IconCalendar,
    IconCatalog,
    IconClients,
    IconInbox,
    IconInvoices,
    IconLogout,
    IconToday,
    Logo,
} from "./icons";

const NAV = [
    { to: "/today", label: "Today", Icon: IconToday },
    { to: "/calendar", label: "Calendar", Icon: IconCalendar },
    { to: "/clients", label: "Clients", Icon: IconClients },
    { to: "/invoices", label: "Invoices", Icon: IconInvoices },
    { to: "/inbox", label: "Inbox", Icon: IconInbox },
    { to: "/catalog", label: "Catalog", Icon: IconCatalog },
];

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
    return (
        <div className="flex h-screen bg-bg text-ink">
            <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
                <div className="flex items-center gap-2 px-5 pb-4 pt-6">
                    <Logo className="h-7 w-7 text-accent" />
                    <span className="text-lg font-bold tracking-tight">Clientbridge</span>
                </div>

                <nav className="flex-1 space-y-1 px-3 py-2">
                    {NAV.map(({ to, label, Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                                    isActive
                                        ? "bg-accent-weak font-semibold text-accent"
                                        : "font-medium text-ink-soft hover:bg-bg"
                                }`
                            }
                        >
                            <Icon className="h-[18px] w-[18px]" />
                            {label}
                        </NavLink>
                    ))}
                </nav>

                <div className="border-t border-line p-3">
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-bg hover:text-ink-soft"
                    >
                        <IconLogout className="h-[18px] w-[18px]" />
                        Sign out
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
