import { bookingPageUrl, businessPageUrl, shopPageUrl } from "@clientbridge/app-core/public";
import { useParams } from "react-router-dom";

import { config } from "./config";

/** The business a page belongs to: its own subdomain, else the slug in the path. */
export function useSlug(): string {
    const { slug } = useParams<{ slug: string }>();
    return slug ?? (config.site?.kind === "page" ? config.site.slug : "");
}

export const links = {
    page: (slug: string): string => businessPageUrl(config.urls.pageUrl, slug),
    booking: (slug: string): string => bookingPageUrl(config.urls.bookUrl, slug),
    shop: (slug: string): string => shopPageUrl(config.urls.shopUrl, slug),
    receipt: (token: string): string =>
        `${config.urls.payUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(token)}`,
};
