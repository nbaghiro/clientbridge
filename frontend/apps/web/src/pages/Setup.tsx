import { type SetupSectionKey, setupSectionsFor, strings } from "@clientbridge/app-core";
import type { ReactElement } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";

import { useRole } from "../lib/auth";

import { GetSetUp } from "../components/GetSetUp";
import { Business } from "./Business";
import { OnlineBooking } from "./OnlineBooking";
import { Reminders } from "./Reminders";
import { Catalog } from "./Catalog";
import { GettingPaid } from "./GettingPaid";
import { Hours } from "./Hours";
import { Taxes } from "./Taxes";
import { Team } from "./Team";

const SETUP_SLUGS: Record<SetupSectionKey, string> = {
    start: "start",
    business: "business",
    services: "services",
    team: "team",
    gettingPaid: "getting-paid",
    taxes: "taxes",
    onlineBooking: "online-booking",
    reminders: "reminders",
};

function sectionBody(key: SetupSectionKey): ReactElement {
    switch (key) {
        case "start":
            return <GetSetUp />;
        case "business":
            return <Business />;
        case "taxes":
            return <Taxes />;
        case "services":
            return <Catalog />;
        case "team":
            return (
                <div className="space-y-10">
                    <Team />
                    <Hours />
                </div>
            );
        case "gettingPaid":
            return <GettingPaid />;
        case "onlineBooking":
            return <OnlineBooking />;
        case "reminders":
            return <Reminders />;
    }
}

export function Setup() {
    const { section } = useParams();
    const role = useRole();
    const sections = setupSectionsFor("web", role);
    const current = sections.find((s) => SETUP_SLUGS[s.key] === section);
    const first = sections[0];
    if (role === null || first === undefined) return null;
    if (current === undefined) return <Navigate to={`/setup/${SETUP_SLUGS[first.key]}`} replace />;

    return (
        <div className="mx-auto flex max-w-6xl gap-8 px-8 py-8">
            <nav className="w-52 shrink-0">
                <h1 className="mb-3 px-3 font-display text-lg font-bold text-ink">
                    {strings.navigation.setup}
                </h1>
                <div className="space-y-0.5">
                    {sections.map((s) => (
                        <NavLink
                            key={s.key}
                            to={`/setup/${SETUP_SLUGS[s.key]}`}
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
                <h2 className="mb-1 font-display text-2xl font-bold text-ink">{current.label}</h2>
                {sectionBody(current.key)}
            </div>
        </div>
    );
}
