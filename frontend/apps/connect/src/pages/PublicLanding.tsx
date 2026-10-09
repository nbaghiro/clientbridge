import { useBusinessFavicon } from "../branding";
import { BusinessShopAction, BusinessSections } from "../components/BusinessNavigation";
import {
    createPublicProfileClient,
    serviceSummary,
    strings,
    usePublicProfile,
} from "@clientbridge/app-core/public";
import {
    Avatar,
    ActionTile,
    Button,
    Icon,
    ItemImage,
    OptionCard,
    Notice,
    Stars,
    Panel,
} from "@clientbridge/ui";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { brandStyle, BusinessCover, PoweredBy } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { isEmbedded } from "../embed";
import { config } from "../config";

const client = createPublicProfileClient(config.apiUrl);
const s = strings.publicLanding;

export function PublicLanding() {
    const { slug = "" } = useParams<{ slug: string }>();
    const view = usePublicProfile(client, slug);
    const navigate = useNavigate();
    const page = view.page;
    useBusinessFavicon(page?.brand);
    const { hash } = useLocation();
    useEffect(() => {
        if (!page || !hash) return;
        const section = hash.slice(1);
        const target =
            section === "visit" && window.matchMedia("(min-width: 768px)").matches
                ? "visit-desktop"
                : section;
        document.getElementById(target)?.scrollIntoView();
    }, [page, hash]);
    const go = (to: string): void => {
        const result = navigate(to);
        if (result) result.catch(() => undefined);
    };
    const book = (service?: string, starts?: string, staff?: string | null): void => {
        const query = new URLSearchParams();
        if (isEmbedded()) query.set("embed", "1");
        if (service) query.set("service", service);
        if (starts) query.set("starts", starts);
        if (staff) query.set("staff", staff);
        go(`/b/${encodeURIComponent(slug)}/book?${query.toString()}`);
    };
    if (view.status === "loading") return <PublicStatus kind="loading" />;
    if (view.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (view.status === "error" || page === null) return <PublicStatus kind="error" />;
    const style = brandStyle(page.brand);
    const hasServices = page.services.length > 0;
    const contact = (
        <div className="space-y-5">
            {page.address ? <p className="text-sm text-ink-soft">{page.address}</p> : null}
            <div className="grid grid-cols-2 gap-2">
                {page.address ? (
                    <ActionTile
                        icon="pin"
                        label={s.directions}
                        onPress={() => {
                            window.location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(page.address ?? "")}`;
                        }}
                    />
                ) : null}
                {page.phone ? (
                    <ActionTile
                        icon="phone"
                        label={s.call}
                        hint={page.phone}
                        onPress={() => {
                            window.location.href = `tel:${page.phone ?? ""}`;
                        }}
                    />
                ) : null}
                {page.email ? (
                    <ActionTile
                        icon="mail"
                        label={s.email}
                        onPress={() => {
                            window.location.href = `mailto:${page.email ?? ""}`;
                        }}
                    />
                ) : null}
                {page.website ? (
                    <ActionTile
                        icon="globe"
                        label={s.website}
                        onPress={() => {
                            window.location.href = page.website ?? "";
                        }}
                    />
                ) : null}
            </div>
            {page.hours.length > 0 ? (
                <div>
                    <h3 className="font-semibold text-ink">{s.hours}</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                        {page.hours.map((hours) => (
                            <div
                                key={`${String(hours.weekday)}-${hours.start}-${hours.end}`}
                                className="flex justify-between gap-3"
                            >
                                <dt className="text-muted">{view.weekday(hours.weekday)}</dt>
                                <dd className="tabular-nums text-ink">
                                    {hours.start}–{hours.end}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-3 text-xs text-muted">{s.hoursHint}</p>
                </div>
            ) : null}
        </div>
    );
    return (
        <div style={style} className="flex min-h-screen flex-col bg-bg pb-24 text-ink md:pb-0">
            <BusinessCover brand={page.brand}>
                <div className="mx-auto flex min-h-[420px] max-w-6xl flex-col px-4 py-8 text-ink sm:px-6 md:min-h-[460px] md:py-12">
                    {page.neighbourhood ? (
                        <p className="text-xs font-medium uppercase tracking-widest">
                            {page.neighbourhood}
                        </p>
                    ) : null}
                    <div className="mt-auto max-w-2xl">
                        <Avatar
                            name={page.business_name}
                            src={page.brand.avatar_url ?? page.brand.logo_url}
                            color={page.brand.primary}
                            size="xl"
                            className="mb-4 !bg-surface p-1"
                        />
                        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                            {page.business_name}
                        </h1>
                        {page.brand.tagline ? (
                            <p className="mt-3 text-lg text-muted">{page.brand.tagline}</p>
                        ) : null}
                        {page.rating !== null && page.review_count > 0 ? (
                            <p className="mt-4 flex items-center gap-2 text-sm">
                                <Icon name="star" size={16} />
                                {s.rating(page.rating.toFixed(1), page.review_count)}
                            </p>
                        ) : null}
                        <div className="mt-6 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:flex-wrap">
                            {hasServices ? (
                                <Button
                                    tone="inverse"
                                    size="lg"
                                    onPress={() => {
                                        book();
                                    }}
                                >
                                    {s.book}
                                </Button>
                            ) : null}
                            <BusinessShopAction />
                        </div>
                    </div>
                </div>
            </BusinessCover>
            <BusinessSections brand={page.brand} />
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1fr)_330px]">
                <main className="min-w-0 space-y-12">
                    {page.about ? (
                        <section aria-label={s.about}>
                            <p className="whitespace-pre-wrap text-lg leading-relaxed">
                                {page.about}
                            </p>
                        </section>
                    ) : null}
                    <section id="services" className="scroll-mt-40">
                        <h2 className="mb-6 font-display text-2xl font-bold">{s.servicesTitle}</h2>
                        {!hasServices ? (
                            <Notice tone="info">{s.noServices}</Notice>
                        ) : (
                            view.categories.map((group) => (
                                <div key={group.label} className="mb-6">
                                    <h3 className="mb-3 border-b border-line pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                        {group.label}
                                    </h3>
                                    <div className="divide-y divide-line-soft">
                                        {group.services.map((service) => (
                                            <div key={service.id} className="py-5">
                                                <div className="flex items-start gap-4">
                                                    <ItemImage
                                                        src={service.image_url}
                                                        name={service.name}
                                                        size={48}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="font-semibold text-ink">
                                                            {service.name}
                                                        </h4>
                                                        <p className="mt-1 text-sm text-muted">
                                                            {serviceSummary(service)}
                                                        </p>
                                                        {service.description ? (
                                                            <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
                                                                {service.description}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onPress={() => {
                                                            book(service.id);
                                                        }}
                                                    >
                                                        {s.book}
                                                    </Button>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2 pl-16">
                                                    {view.openingsStatus === "loading" ? (
                                                        <p className="text-xs text-muted">
                                                            {s.loadingOpenings}
                                                        </p>
                                                    ) : view.openingsStatus === "error" ? (
                                                        <Button
                                                            variant="link"
                                                            size="sm"
                                                            onPress={() => {
                                                                book(service.id);
                                                            }}
                                                        >
                                                            {s.openingsUnavailable}
                                                        </Button>
                                                    ) : (view.openings[service.id] ?? []).length ===
                                                      0 ? (
                                                        <p className="text-xs text-muted">
                                                            {s.noOpenings}
                                                        </p>
                                                    ) : (
                                                        (view.openings[service.id] ?? []).map(
                                                            (slot) => (
                                                                <Button
                                                                    key={slot.starts_at}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onPress={() => {
                                                                        book(
                                                                            service.id,
                                                                            slot.starts_at,
                                                                            slot.staff_id,
                                                                        );
                                                                    }}
                                                                >
                                                                    {view.openingLabel(
                                                                        slot.starts_at,
                                                                    )}
                                                                </Button>
                                                            ),
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </section>
                    {page.gallery_urls.length > 0 ? (
                        <section aria-label={s.gallery}>
                            <h2 className="mb-4 font-display text-2xl font-bold">{s.gallery}</h2>
                            <div className="grid grid-cols-2 gap-3">
                                {page.gallery_urls.map((url, index) => (
                                    <img
                                        key={`${url}-${String(index)}`}
                                        src={url}
                                        alt=""
                                        loading="lazy"
                                        className="aspect-[4/3] w-full rounded-xl object-cover"
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {page.staff.length > 0 ? (
                        <section id="team" className="scroll-mt-40">
                            <h2 className="mb-4 font-display text-2xl font-bold">{s.team}</h2>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {page.staff.map((person) => (
                                    <OptionCard
                                        key={person.id}
                                        title={person.name ?? person.title ?? page.business_name}
                                        subtitle={person.title ?? undefined}
                                        leading={
                                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-weak text-lg font-bold text-accent">
                                                {(person.name ?? page.business_name).slice(0, 1)}
                                            </span>
                                        }
                                        onPress={() => {
                                            book(undefined, undefined, person.id);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {page.review_count > 0 ? (
                        <section id="reviews" className="scroll-mt-40">
                            <h2 className="mb-2 font-display text-2xl font-bold">{s.reviews}</h2>
                            {page.rating !== null ? (
                                <Panel className="mb-4 !bg-surface p-1">
                                    <div className="flex flex-wrap items-center gap-4">
                                        <p className="font-display text-4xl font-bold tabular-nums">
                                            {page.rating.toFixed(1)}
                                        </p>
                                        <div className="space-y-1">
                                            <Stars value={Math.round(page.rating)} />
                                            <p className="text-sm text-muted">
                                                {s.rating(
                                                    page.rating.toFixed(1),
                                                    page.review_count,
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </Panel>
                            ) : null}
                            <div className="grid items-start gap-4 sm:grid-cols-2">
                                {page.reviews.slice(0, 4).map((review) => (
                                    <Panel key={review.id}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-sm font-semibold">{s.reviewer}</p>
                                            <Stars value={review.rating} size="sm" />
                                        </div>
                                        {review.body ? (
                                            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                                                {review.body}
                                            </p>
                                        ) : null}
                                        {review.response ? (
                                            <div className="mt-4 border-t border-line-soft pt-3 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <Avatar
                                                        name={page.business_name}
                                                        src={
                                                            page.brand.avatar_url ??
                                                            page.brand.logo_url
                                                        }
                                                        size="sm"
                                                    />
                                                    <p className="font-semibold">{s.response}</p>
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap text-muted">
                                                    {review.response}
                                                </p>
                                            </div>
                                        ) : null}
                                    </Panel>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <section id="visit" className="scroll-mt-40 md:hidden">
                        <h2 className="mb-4 font-display text-2xl font-bold">{s.visit}</h2>
                        {contact}
                    </section>
                    {page.policy ? (
                        <section id="policies" className="scroll-mt-40">
                            <h2 className="mb-4 font-display text-2xl font-bold">{s.policies}</h2>
                            <ul className="space-y-2 text-sm text-ink-soft">
                                {page.policy.self_service ? (
                                    <>
                                        <li>{s.cancelPolicy(page.policy.cancel_cutoff_hours)}</li>
                                        <li>
                                            {s.reschedulePolicy(
                                                page.policy.reschedule_cutoff_hours,
                                            )}
                                        </li>
                                    </>
                                ) : (
                                    <li>{s.contactPolicy}</li>
                                )}
                                {page.policy.late_cancel_deposit === "keep" ? (
                                    <li>{s.lateCancelPolicy}</li>
                                ) : null}
                            </ul>
                        </section>
                    ) : null}
                </main>
                <aside id="visit-desktop" className="hidden scroll-mt-40 md:block">
                    <div className="sticky top-20 space-y-4">
                        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <h2 className="font-display text-lg font-bold">{s.visit}</h2>
                            <ul className="mt-4 space-y-4 border-t border-line-soft pt-4">
                                {page.services.slice(0, 3).map((service) => (
                                    <li key={service.id}>
                                        <p className="text-sm font-semibold">{service.name}</p>
                                        <p className="mt-1 text-xs text-muted">
                                            {serviceSummary(service)}
                                        </p>
                                        {view.openings[service.id]?.[0] ? (
                                            <p className="mt-1 text-xs text-accent">
                                                {view.openingLabel(
                                                    view.openings[service.id]?.[0]?.starts_at ?? "",
                                                )}
                                            </p>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                            {hasServices ? (
                                <Button
                                    full
                                    size="lg"
                                    className="mt-5"
                                    onPress={() => {
                                        book();
                                    }}
                                >
                                    {s.book}
                                </Button>
                            ) : null}
                        </section>
                        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                            {contact}
                        </section>
                    </div>
                </aside>
            </div>
            <PoweredBy />
            {hasServices ? (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
                    <Button
                        full
                        size="lg"
                        onPress={() => {
                            book();
                        }}
                    >
                        {s.book}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
