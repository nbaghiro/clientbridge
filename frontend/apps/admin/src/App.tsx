import { useEffect, type ReactNode } from "react";
import { config } from "./config";
import { checkAdminAccess, useAdminAccess, strings } from "@clientbridge/app-core/public";
import { Button, Lockup, PageHeader, Panel } from "@clientbridge/ui";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Overview } from "./pages/Overview";
import { Businesses, BusinessDetail } from "./pages/Businesses";
import { People, PersonDetail } from "./pages/People";
import { Payments, PaymentDetail } from "./pages/Payments";
import { Activity } from "./pages/Activity";
import { Emails } from "./pages/Emails";
import { Operations } from "./pages/Operations";
import { Access } from "./pages/Access";

const checkAccess = () => checkAdminAccess(config.apiUrl);

function subscribeAccess(refresh: () => void): () => void {
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
        window.removeEventListener("focus", refresh);
        window.clearInterval(interval);
    };
}

export function App() {
    const access = useAdminAccess(checkAccess, subscribeAccess);
    useEffect(() => {
        if (access === "signedOut")
            window.location.replace(new URL("/admin-login?session=1", config.webUrl));
    }, [access]);
    if (access === "loading" || access === "signedOut") return null;
    if (access !== "allowed")
        return (
            <main className="mx-auto max-w-xl p-8">
                <Panel
                    title={access === "denied" ? strings.admin.denied : strings.admin.unavailable}
                >
                    <p>
                        {access === "denied"
                            ? strings.admin.deniedDetail
                            : strings.admin.unavailableDetail}
                    </p>
                    <Button
                        onPress={() => {
                            window.location.assign(config.webUrl);
                        }}
                    >
                        {strings.admin.backToApp}
                    </Button>
                    <Button
                        variant="outline"
                        onPress={() => {
                            window.location.reload();
                        }}
                    >
                        {strings.admin.retry}
                    </Button>
                </Panel>
            </main>
        );
    return <Dashboard />;
}

function Dashboard() {
    const sections = [
        { path: "overview", title: strings.admin.overview, detail: strings.admin.overviewDetail },
        {
            path: "businesses",
            title: strings.admin.businesses,
            detail: strings.admin.businessesDetail,
        },
        { path: "people", title: strings.admin.people, detail: strings.admin.peopleDetail },
        { path: "payments", title: strings.admin.payments, detail: strings.admin.paymentsDetail },
        { path: "emails", title: strings.admin.emails, detail: strings.admin.emailsDetail },
        { path: "activity", title: strings.admin.activity, detail: strings.admin.activityDetail },
        {
            path: "operations",
            title: strings.admin.operations,
            detail: strings.admin.operationsDetail,
        },
        { path: "access", title: strings.admin.access, detail: strings.admin.accessDetailPage },
    ];
    const pages = [
        <Overview />,
        <Businesses />,
        <People />,
        <Payments />,
        <Emails />,
        <Activity />,
        <Operations />,
        <Access />,
    ];
    return (
        <BrowserRouter>
            <div className="admin-shell">
                <aside className="admin-sidebar">
                    <div className="admin-brand">
                        <Lockup className="text-xl" markClassName="text-inherit" />
                    </div>
                    <p className="mb-8 px-3 text-sm">{strings.admin.title}</p>
                    <nav aria-label={strings.admin.navigation}>
                        {sections.map((section) => (
                            <NavLink key={section.path} to={`/${section.path}`}>
                                {section.title}
                            </NavLink>
                        ))}
                    </nav>
                </aside>
                <div className="min-w-0">
                    <header className="flex flex-wrap justify-between gap-3 border-b border-line bg-surface px-6 py-4 text-sm">
                        <span className="font-semibold text-accent">{strings.admin.title}</span>
                        <a href={config.webUrl} className="text-muted hover:text-accent">
                            {strings.admin.backToApp}
                        </a>
                    </header>
                    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
                        <RouteContent>
                            <Routes>
                                {sections.map((section, index) => (
                                    <Route
                                        key={section.path}
                                        path={`/${section.path}`}
                                        element={
                                            <>
                                                <PageHeader
                                                    title={section.title}
                                                    subtitle={section.detail}
                                                />
                                                {pages[index]}
                                            </>
                                        }
                                    />
                                ))}
                                <Route path="/businesses/:id" element={<BusinessDetail />} />
                                <Route path="/people/:id" element={<PersonDetail />} />
                                <Route path="/payments/:id" element={<PaymentDetail />} />
                                <Route path="*" element={<Navigate to="/overview" replace />} />
                            </Routes>
                        </RouteContent>
                    </main>
                </div>
            </div>
        </BrowserRouter>
    );
}

function RouteContent({ children }: { children: ReactNode }) {
    const location = useLocation();
    return (
        <div key={location.pathname + location.search} className="space-y-6">
            {children}
        </div>
    );
}
