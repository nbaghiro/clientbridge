import {
    type PublicService,
    createPublicBookingClient,
    formatMoneyWithCurrency,
    strings,
    usePublicBusiness,
} from "@clientbridge/app-core/public";
import { Link, useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { isEmbedded } from "../embed";

const booking = createPublicBookingClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

/** A business's branded home (`/b/:slug`) — the link-in-bio target for providers without their own
 *  site. Reuses the booking-page profile for the brand + a services preview, then links to booking. */
export function PublicLanding() {
    const { slug = "" } = useParams<{ slug: string }>();
    const { status, page } = usePublicBusiness(booking, slug);

    if (status === "loading")
        return (
            <PublicFrame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</PublicFrame>
        );

    if (status === "not-found")
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicLanding.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicLanding.notFoundBody}</p>
            </PublicFrame>
        );

    if (status === "error" || page === null)
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </PublicFrame>
        );

    const bookTo = `/book/${encodeURIComponent(slug)}${isEmbedded() ? "?embed=1" : ""}`;

    return (
        <PublicFrame brand={page.brand}>
            <h1 className="text-center font-display text-2xl font-bold text-ink">
                {page.business_name}
            </h1>
            {page.services.length > 0 ? (
                <>
                    <div className="mt-6">
                        <p className="mb-2 text-sm font-medium text-ink-soft">
                            {strings.publicLanding.servicesTitle}
                        </p>
                        <ul className="space-y-2">
                            {page.services.map((s) => (
                                <li
                                    key={s.id}
                                    className="flex items-baseline justify-between gap-3 border-b border-line pb-2 text-sm"
                                >
                                    <span className="text-ink">{s.name}</span>
                                    <span className="shrink-0 tabular-nums text-muted">
                                        {serviceMeta(s)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <Link
                        to={bookTo}
                        className="mt-6 block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-ink transition hover:opacity-90"
                    >
                        {strings.publicLanding.book}
                    </Link>
                </>
            ) : null}
        </PublicFrame>
    );
}

function serviceMeta(s: PublicService): string {
    const price = formatMoneyWithCurrency(s.price_cents, s.currency);
    const mins =
        s.duration_min !== null ? strings.publicBooking.durationSuffix(s.duration_min) : "";
    return `${price}${mins}`;
}
