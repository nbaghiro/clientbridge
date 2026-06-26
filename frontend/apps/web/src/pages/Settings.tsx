import { NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
    { to: "/settings/account", label: "Account" },
    { to: "/settings/catalog", label: "Catalog & services" },
    { to: "/settings/taxes", label: "Taxes" },
    { to: "/settings/scheduling", label: "Scheduling" },
    { to: "/settings/booking", label: "Booking & forms" },
];

export function SettingsLayout() {
    return (
        <div className="mx-auto flex max-w-6xl gap-8 px-8 py-8">
            <nav className="w-52 shrink-0">
                <h1 className="mb-3 px-3 font-display text-lg font-bold text-ink">Settings</h1>
                <div className="space-y-0.5">
                    {SECTIONS.map((s) => (
                        <NavLink
                            key={s.to}
                            to={s.to}
                            className={({ isActive }) =>
                                `block rounded-md px-3 py-2 text-sm transition ${
                                    isActive
                                        ? "bg-accent-weak font-semibold text-accent"
                                        : "font-medium text-ink-soft hover:bg-bg"
                                }`
                            }
                        >
                            {s.label}
                        </NavLink>
                    ))}
                </div>
            </nav>
            <div className="min-w-0 flex-1">
                <Outlet />
            </div>
        </div>
    );
}
