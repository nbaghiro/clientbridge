import { SETTINGS_SECTIONS, strings } from "@clientbridge/app-core";
import { NavLink, Outlet } from "react-router-dom";

export function SettingsLayout() {
    return (
        <div className="mx-auto flex max-w-6xl gap-8 px-8 py-8">
            <nav className="w-52 shrink-0">
                <h1 className="mb-3 px-3 font-display text-lg font-bold text-ink">
                    {strings.settings.title}
                </h1>
                <div className="space-y-0.5">
                    {SETTINGS_SECTIONS.map((s) => (
                        <NavLink
                            key={s.key}
                            to={`/settings/${s.key}`}
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
