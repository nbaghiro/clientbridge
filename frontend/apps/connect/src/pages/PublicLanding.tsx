import {
    createPublicBookingClient,
    serviceSummary,
    strings,
    usePublicBusiness,
} from "@clientbridge/app-core/public";
import { ItemImage, primaryButtonLarge } from "@clientbridge/ui";
import { Link, useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { isEmbedded } from "../embed";
import { config } from "../config";

const booking = createPublicBookingClient(config.apiUrl);

/** The business home page (`/b/:slug`) for providers without their own site. */
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
                                    className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm"
                                >
                                    <span className="flex items-center gap-3">
                                        <ItemImage src={s.image_url} name={s.name} size={36} />
                                        <span className="text-ink">{s.name}</span>
                                    </span>
                                    <span className="shrink-0 tabular-nums text-muted">
                                        {serviceSummary(s)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <Link
                        to={bookTo}
                        className={`${primaryButtonLarge} mt-6 block w-full text-center`}
                    >
                        {strings.publicLanding.book}
                    </Link>
                </>
            ) : null}
            {page.addons.length > 0 ? (
                <Link
                    to={`/shop/${encodeURIComponent(slug)}`}
                    className="mt-3 block w-full rounded-md border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink-soft transition hover:bg-bg"
                >
                    {strings.publicBooking.shopLink}
                </Link>
            ) : null}
        </PublicFrame>
    );
}
