import {
    DESTINATIONS,
    type DestinationKey,
    type IconName,
    strings,
    useStripeAccountId,
} from "@clientbridge/app-core";
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Icon, Lockup, setStripeAccount } from "@clientbridge/ui";

const DESTINATION_WEB: Record<DestinationKey, { to: string; icon: IconName }> = {
    today: { to: "/today", icon: "today" },
    schedule: { to: "/schedule", icon: "calendar" },
    clients: { to: "/clients", icon: "clients" },
    payments: { to: "/payments", icon: "invoices" },
    inbox: { to: "/inbox", icon: "inbox" },
};

const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
        isActive
            ? "bg-accent-weak font-semibold text-accent"
            : "font-medium text-ink-soft hover:bg-bg"
    }`;

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
    const stripeAccount = useStripeAccountId();
    useEffect(() => {
        setStripeAccount(stripeAccount);
    }, [stripeAccount]);

    return (
        <div className="flex h-screen bg-bg text-ink">
            <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
                <Lockup className="px-5 pb-5 pt-6 text-lg" />

                <div className="border-b border-line" />

                <nav className="flex-1 space-y-1 px-3 py-4">
                    {DESTINATIONS.map(({ key, label }) => {
                        const { to, icon } = DESTINATION_WEB[key];
                        return (
                            <NavLink key={key} to={to} className={linkClass}>
                                <Icon name={icon} />
                                {label}
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="space-y-1 border-t border-line p-3">
                    <NavLink to="/setup" className={linkClass}>
                        <Icon name="settings" />
                        {strings.navigation.setup}
                    </NavLink>
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-bg hover:text-ink-soft"
                    >
                        <Icon name="logout" />
                        {strings.navigation.signOut}
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
