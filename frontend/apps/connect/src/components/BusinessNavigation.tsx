import { useBusinessFavicon } from "../branding";
import {
    type PublicBrand,
    createPublicProfileClient,
    createPublicShopClient,
    strings,
    usePublicBusinessNavigation,
} from "@clientbridge/app-core/public";
import { Avatar, Button, Icon } from "@clientbridge/ui";
import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { config } from "../config";
import { isEmbedded } from "../embed";

const profile = createPublicProfileClient(config.apiUrl);
const shop = createPublicShopClient(config.apiUrl);
const s = strings.publicLanding;

export function BusinessNavigation({
    brand,
    cartCount,
}: {
    brand?: PublicBrand | null | undefined;
    cartCount?: number | undefined;
}) {
    useBusinessFavicon(brand);
    const { slug } = useParams<{ slug: string }>();
    const businessSlug = brand?.public_slug === null ? undefined : (brand?.public_slug ?? slug);
    if (isEmbedded() || !businessSlug) return null;
    return (
        <Navigation key={businessSlug} slug={businessSlug} brand={brand} cartCount={cartCount} />
    );
}

function Navigation({
    slug,
    brand,
    cartCount,
}: {
    slug: string;
    brand?: PublicBrand | null | undefined;
    cartCount?: number | undefined;
}) {
    const available = usePublicBusinessNavigation(profile, shop, slug);
    const { pathname } = useLocation();
    const menu = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const dismiss = (event: PointerEvent) => {
            if (
                menu.current &&
                event.target instanceof Node &&
                !menu.current.contains(event.target)
            )
                menu.current.open = false;
        };
        document.addEventListener("pointerdown", dismiss);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
        };
    }, []);

    const home = `/b/${encodeURIComponent(slug)}`;
    const shopping = pathname === `${home}/shop`;
    const taskPage = pathname !== home && pathname !== `${home}/book` && !shopping;
    const links = [
        { path: home, label: s.home, end: true },
        ...(available.booking ? [{ path: `${home}/book`, label: s.booking, end: false }] : []),
        ...(available.shop ? [{ path: `${home}/shop`, label: s.shop, end: false }] : []),
    ];
    const items = links.map((link) => (
        <NavLink
            key={link.path}
            to={link.path}
            end={link.end}
            onClick={() => {
                if (menu.current) menu.current.open = false;
            }}
            className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-semibold ${isActive ? "bg-current/10 underline underline-offset-4" : "hover:underline underline-offset-4"}`
            }
        >
            {link.label}
        </NavLink>
    ));
    return (
        <nav
            aria-label={s.navigation}
            className="relative z-30 bg-accent text-[var(--brand-ink,var(--accent-ink))] print:hidden"
        >
            <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
                <Link to={home} className="flex min-w-0 items-center gap-2 rounded-md">
                    <Avatar
                        name={brand?.business_name ?? ""}
                        src={brand?.avatar_url ?? brand?.logo_url}
                        size="sm"
                        className="shrink-0 !bg-surface"
                    />
                    <span className="truncate text-sm font-semibold">
                        {brand?.business_name ?? s.home}
                    </span>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                    {!taskPage ? <div className="hidden items-center sm:flex">{items}</div> : null}
                    <details
                        ref={menu}
                        className={`relative ${taskPage ? "" : "sm:hidden"}`}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && menu.current) {
                                menu.current.open = false;
                                menu.current.querySelector("summary")?.focus();
                            }
                        }}
                    >
                        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                            {s.menu}
                            <Icon name="chevronDown" size={14} />
                        </summary>
                        <div className="absolute left-0 top-full mt-2 flex min-w-40 sm:left-auto sm:right-0 flex-col rounded-xl border border-line bg-surface p-2 text-ink shadow-pop">
                            {items}
                        </div>
                    </details>
                    {shopping && available.shop ? (
                        <Link
                            to={`${home}/shop?cart=1`}
                            className="flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold"
                        >
                            <Icon name="bag" size={17} />
                            <span>
                                {s.cart}
                                {cartCount === undefined ? "" : ` (${String(cartCount)})`}
                            </span>
                        </Link>
                    ) : null}
                </div>
            </div>
        </nav>
    );
}

export function BusinessSections({ brand }: { brand: PublicBrand }) {
    const { slug = "" } = useParams();
    const available = usePublicBusinessNavigation(profile, shop, slug);
    if (isEmbedded()) return null;
    return (
        <nav aria-label={s.jumpTo} className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 py-4 text-sm text-ink-soft sm:px-6">
                {[
                    ...(available.booking ? [{ key: "services", label: s.servicesTitle }] : []),
                    ...(available.team ? [{ key: "team", label: s.team }] : []),
                    ...(available.reviews ? [{ key: "reviews", label: s.reviews }] : []),
                    { key: "visit", label: s.visit },
                    ...(available.policies ? [{ key: "policies", label: s.policies }] : []),
                ].map((section) => (
                    <Link
                        key={section.key}
                        to={`/b/${encodeURIComponent(brand.public_slug ?? slug)}#${section.key}`}
                        className="whitespace-nowrap hover:text-accent"
                    >
                        {section.label}
                    </Link>
                ))}
            </div>
        </nav>
    );
}

export function BusinessShopAction() {
    const { slug = "" } = useParams();
    const available = usePublicBusinessNavigation(profile, shop, slug);
    const navigate = useNavigate();
    if (!available.shop) return null;
    return (
        <Button
            tone="inverse"
            variant="outline"
            size="lg"
            onPress={() => {
                const result = navigate(
                    `/b/${encodeURIComponent(slug)}/shop${isEmbedded() ? "?embed=1" : ""}`,
                );
                if (result) result.catch(() => undefined);
            }}
        >
            {strings.publicBooking.shopLink}
        </Button>
    );
}
