import { Backdrop, confirm } from "@clientbridge/ui";
import {
    DESTINATIONS,
    mediaUrl,
    DESTINATION_TARGET,
    type DestinationKey,
    type IconName,
    type SyncNotice,
    strings,
    useNotifications,
    usePeoplePhotos,
    usePlanNotice,
    useShellNav,
    useStripeAccountId,
    useSyncState,
} from "@clientbridge/app-core";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    Icon,
    IconButton,
    Notice,
    SyncBanner,
    setStripeAccount,
} from "@clientbridge/ui";

import { api, apiBaseUrl } from "../lib/api";
import { connectPowerSync } from "../lib/powersync";
import { getUserId, useViewer } from "../lib/auth";
import { ShellContext, linkPath, useOpenLink } from "../lib/links";
import { CommandPalette } from "./CommandPalette";
import { NotificationsPanel } from "./NotificationsPanel";
import { SignOutDialog } from "./SignOutDialog";

const ICON: Record<DestinationKey, IconName> = {
    today: "today",
    schedule: "calendar",
    clients: "clients",
    payments: "invoices",
    inbox: "inbox",
};

const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
        isActive
            ? "bg-accent-weak font-semibold text-accent"
            : "font-medium text-ink-soft hover:bg-bg"
    }`;

function PlanBanner() {
    const notice = usePlanNotice(useViewer()?.role ?? null);
    const navigate = useNavigate();
    if (notice === null) return null;
    return (
        <div className="px-8 pt-4">
            <Notice tone={notice.tone} banner>
                <span className="flex flex-wrap items-center justify-between gap-3">
                    {notice.message}
                    {notice.action !== null ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                const done = navigate("/setup/plan");
                                if (done) done.catch(() => undefined);
                            }}
                        >
                            {notice.action}
                        </Button>
                    ) : null}
                </span>
            </Notice>
        </div>
    );
}

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
    const stripeAccount = useStripeAccountId();
    useEffect(() => {
        setStripeAccount(stripeAccount);
    }, [stripeAccount]);

    const viewer = useViewer();
    const nav = useShellNav(viewer);
    const notifications = useNotifications(viewer);
    const sync = useSyncState();
    const [createOpen, setCreateOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [bellOpen, setBellOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const location = useLocation();
    const controls = useMemo(
        () => ({
            openSearch: () => {
                setSearchOpen(true);
            },
            openNotifications: () => {
                setBellOpen(true);
            },
        }),
        [],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    useEffect(() => {
        setBellOpen(false);
    }, [location.pathname, location.search]);

    const signOut = (): void => {
        if (!sync.queueKnown || sync.pendingCount > 0) setLeaving(true);
        else onSignOut();
    };
    const nextStep = nav.setup.steps.find((s) => !s.done);

    return (
        <ShellContext.Provider value={controls}>
            <ShellBody
                nav={nav}
                notifications={notifications}
                createOpen={createOpen}
                setCreateOpen={setCreateOpen}
                bellOpen={bellOpen}
                setBellOpen={setBellOpen}
                accountOpen={accountOpen}
                setAccountOpen={setAccountOpen}
                onSearch={() => {
                    setSearchOpen(true);
                }}
                onSignOut={signOut}
                setupHref={nextStep === undefined ? "/setup" : linkPath(nextStep.target)}
                onDiscardSync={
                    sync.rejectedCount > 0
                        ? () => {
                              confirm({
                                  title: strings.sync.discardRejected,
                                  message: strings.sync.discardRejectedDetail,
                                  confirmLabel: strings.sync.discardRejected,
                                  destructive: true,
                              })
                                  .then(async (ok) => {
                                      if (ok) await sync.discardRejected();
                                  })
                                  .catch(() => undefined);
                          }
                        : undefined
                }
                notice={sync.notice}
                onRetrySync={() => {
                    connectPowerSync(api).catch(() => undefined);
                }}
            />
            {searchOpen ? (
                <CommandPalette
                    viewer={viewer}
                    onClose={() => {
                        setSearchOpen(false);
                    }}
                />
            ) : null}
            <SignOutDialog
                open={leaving}
                pending={sync.pending}
                pendingCount={sync.queueKnown ? sync.pendingCount : null}
                onCancel={() => {
                    setLeaving(false);
                }}
                onConfirm={() => {
                    setLeaving(false);
                    onSignOut();
                }}
            />
        </ShellContext.Provider>
    );
}

function ShellBody({
    nav,
    notifications,
    createOpen,
    setCreateOpen,
    bellOpen,
    setBellOpen,
    accountOpen,
    setAccountOpen,
    onSearch,
    onSignOut,
    setupHref,
    notice,
    onRetrySync,
    onDiscardSync,
}: {
    nav: ReturnType<typeof useShellNav>;
    notifications: ReturnType<typeof useNotifications>;
    createOpen: boolean;
    setCreateOpen: (open: boolean) => void;
    bellOpen: boolean;
    setBellOpen: (open: boolean) => void;
    accountOpen: boolean;
    setAccountOpen: (open: boolean) => void;
    onSearch: () => void;
    onSignOut: () => void;
    setupHref: string;
    notice: SyncNotice | null;
    onRetrySync: () => void;
    onDiscardSync?: (() => void) | undefined;
}) {
    const photos = usePeoplePhotos();
    const openLink = useOpenLink();
    const n = strings.navigation;
    return (
        <div className="flex h-screen bg-bg text-ink">
            <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface">
                <div className="px-3 pb-3 pt-4">
                    <NavLink
                        to="/setup/business"
                        aria-label={n.businessMenu}
                        className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg"
                    >
                        <Avatar
                            name={nav.setup.businessName}
                            size="sm"
                            color={nav.brandColor}
                            variant="mark"
                            src={
                                nav.setup.logoFileId
                                    ? mediaUrl(apiBaseUrl, nav.setup.logoFileId)
                                    : null
                            }
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                            {nav.setup.businessName}
                        </span>
                        <span className="text-muted">
                            <Icon name="chevronDown" size={15} />
                        </span>
                    </NavLink>
                </div>

                <div className="space-y-2 px-3">
                    <div className="relative flex gap-2">
                        <Button
                            grow
                            icon="plus"
                            onPress={() => {
                                setCreateOpen(!createOpen);
                            }}
                        >
                            {n.createMenu}
                        </Button>
                        <NotificationsPanel
                            view={notifications}
                            open={bellOpen}
                            onToggle={setBellOpen}
                        />
                        <ActionMenu
                            open={createOpen}
                            onClose={() => {
                                setCreateOpen(false);
                            }}
                            title={n.createMenu}
                            items={nav.create}
                            onSelect={(key) => {
                                setCreateOpen(false);
                                const action = nav.create.find((a) => a.key === key);
                                if (action !== undefined) openLink(action.target);
                            }}
                        />
                    </div>
                    <Button full variant="outline" onPress={onSearch} icon="search">
                        <span className="flex flex-1 items-center justify-between gap-2">
                            <span className="text-muted">{n.search}</span>
                            <kbd className="font-mono text-[11px] text-muted">
                                {n.searchShortcut}
                            </kbd>
                        </span>
                    </Button>
                </div>

                <nav
                    aria-label={n.main}
                    className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 py-2"
                >
                    {DESTINATIONS.map(({ key, label }) => {
                        const badge = nav.badges[key];
                        return (
                            <NavLink
                                key={key}
                                to={linkPath(DESTINATION_TARGET[key])}
                                className={linkClass}
                            >
                                <Icon name={ICON[key]} size={18} />
                                <span className="flex-1">{label}</span>
                                {badge !== undefined && badge > 0 ? (
                                    <Badge label={badge} variant="count" />
                                ) : null}
                            </NavLink>
                        );
                    })}
                </nav>

                {nav.showSetup ? (
                    <NavLink
                        to={setupHref}
                        className="mx-3 mb-3 block rounded-md border border-line-soft bg-bg px-3 py-2.5 hover:border-accent-line"
                    >
                        <span className="flex items-center justify-between text-xs font-semibold text-ink">
                            {n.finishSetup}
                            <span className="font-medium text-muted">
                                {n.setupProgress(nav.setup.done, nav.setup.total)}
                            </span>
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface2">
                            <span
                                className="block h-full rounded-full bg-accent"
                                style={{
                                    width: `${String((nav.setup.done / nav.setup.total) * 100)}%`,
                                }}
                            />
                        </span>
                    </NavLink>
                ) : null}

                <div className="border-t border-line p-3">
                    <NavLink to="/setup" className={linkClass}>
                        <Icon name="settings" size={18} />
                        {n.setup}
                    </NavLink>
                    <div className="mt-2 flex items-center gap-2.5 rounded-md px-2 py-1.5">
                        <Avatar
                            name={nav.name}
                            src={photos.user(getUserId())}
                            size="sm"
                            color={nav.color}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-ink">{nav.name}</div>
                            <div className="truncate text-xs text-muted">{nav.roleLabel}</div>
                        </div>
                        <div className="relative">
                            <IconButton
                                icon="more"
                                label={n.accountMenu}
                                size="sm"
                                pressed={accountOpen}
                                onPress={() => {
                                    setAccountOpen(!accountOpen);
                                }}
                            />
                            <ActionMenu
                                open={accountOpen}
                                onClose={() => {
                                    setAccountOpen(false);
                                }}
                                placement="above-end"
                                title={nav.name}
                                items={[
                                    { key: "hours", label: n.yourHours, icon: "clock" },
                                    { key: "signOut", label: n.signOut, icon: "logout" },
                                ]}
                                onSelect={(key) => {
                                    setAccountOpen(false);
                                    if (key === "signOut") onSignOut();
                                    else openLink("hours");
                                }}
                            />
                        </div>
                    </div>
                </div>
            </aside>

            <div className="relative isolate flex min-w-0 flex-1">
                {/* Outside the scrolling area, so the art stays in the window's corner. */}
                <Backdrop corner="bottomRight" />
                <main className="relative flex-1 overflow-y-auto">
                    {notice !== null ? (
                        <div className="sticky top-0 z-10">
                            <SyncBanner
                                state={notice.state}
                                title={notice.title}
                                detail={notice.detail}
                                action={
                                    onDiscardSync
                                        ? {
                                              label: strings.sync.discardRejected,
                                              onPress: onDiscardSync,
                                          }
                                        : notice.retry
                                          ? { label: strings.sync.retry, onPress: onRetrySync }
                                          : undefined
                                }
                            />
                        </div>
                    ) : null}
                    <PlanBanner />
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
