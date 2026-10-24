import { type SetupSectionKey, setupSectionsFor, strings } from "@clientbridge/app-core";
import type { ReactElement } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";

import { useRole } from "../lib/auth";

import { GetSetUp } from "../components/GetSetUp";
import { Business } from "./Business";
import { OnlineBooking } from "./OnlineBooking";
import { Reminders } from "./Reminders";
import { Resources } from "./Resources";
import { Security } from "./Security";
import { Catalog } from "./Catalog";
import { GettingPaid } from "./GettingPaid";
import { Hours } from "./Hours";
import { Plans } from "./Plans";
import { Taxes } from "./Taxes";
import { Team } from "./Team";
import { PageFrame } from "../components/PageFrame";

const SETUP_SLUGS: Record<SetupSectionKey, string> = {
    start: "start",
    business: "business",
    services: "services",
    resources: "rooms-and-equipment",
    team: "team",
    gettingPaid: "getting-paid",
    plan: "plan",
    taxes: "taxes",
    onlineBooking: "online-booking",
    reminders: "reminders",
    security: "security",
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
        case "resources":
            return <Resources />;
        case "team":
            return (
                <div className="space-y-10">
                    <Team />
                    <Hours />
                </div>
            );
        case "gettingPaid":
            return <GettingPaid />;
        case "plan":
            return <Plans />;
        case "onlineBooking":
            return <OnlineBooking />;
        case "reminders":
            return <Reminders />;
        case "security":
            return <Security />;
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
        <PageFrame className="flex gap-8">
            <nav aria-label={strings.navigation.setup} className="w-52 shrink-0">
                <p className="mb-3 px-3 font-display text-lg font-bold text-ink">
                    {strings.navigation.setup}
                </p>
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
            <div className="min-w-0 flex-1">{sectionBody(current.key)}</div>
        </PageFrame>
    );
}
