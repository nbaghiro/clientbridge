import {
    createPublicBookingClient,
    serviceSummary,
    strings,
    usePublicBusiness,
} from "@clientbridge/app-core/public";
import { Button, ItemImage } from "@clientbridge/ui";
import { useNavigate, useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicStatus } from "../components/PublicStatus";
import { isEmbedded } from "../embed";
import { config } from "../config";

const booking = createPublicBookingClient(config.apiUrl);

/** The business home page (`/b/:slug`) for providers without their own site. */
export function PublicLanding() {
    const { slug = "" } = useParams<{ slug: string }>();
    const { status, page } = usePublicBusiness(booking, slug);
    const navigate = useNavigate();
    const go = (to: string): void => {
        const navigated = navigate(to);
        if (navigated) navigated.catch(() => undefined);
    };

    if (status === "loading") return <PublicStatus kind="loading" />;

    if (status === "not-found")
        return (
            <PublicStatus
                kind="notFound"
                title={strings.publicLanding.notFoundTitle}
                body={strings.publicLanding.notFoundBody}
            />
        );

    if (status === "error" || page === null) return <PublicStatus kind="error" />;

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
                    <div className="mt-6">
                        <Button
                            size="lg"
                            full
                            onPress={() => {
                                go(bookTo);
                            }}
                        >
                            {strings.publicLanding.book}
                        </Button>
                    </div>
                </>
            ) : null}
            {page.addons.length > 0 ? (
                <div className="mt-3">
                    <Button
                        variant="outline"
                        size="lg"
                        full
                        onPress={() => {
                            go(`/shop/${encodeURIComponent(slug)}`);
                        }}
                    >
                        {strings.publicBooking.shopLink}
                    </Button>
                </div>
            ) : null}
        </PublicFrame>
    );
}
