import { LOGO } from "@clientbridge/app-core/public";
import { renderToString } from "react-dom/server";

import { App } from "./App";
import { config } from "./config";
import { headTags, ogImageFor } from "./head";
import { fileFor, NOT_FOUND, ROUTES, type SiteRoute } from "./routes";

export interface RenderedPage {
    path: string;
    file: string;
    title: string;
    headline: string;
    description: string;
    ogImage: string;
    indexable: boolean;
    head: string;
    html: string;
}

const render = (route: SiteRoute): RenderedPage => ({
    path: route.path,
    file: fileFor(route),
    title: route.meta.title,
    headline: route.meta.headline,
    description: route.meta.description,
    ogImage: ogImageFor(route.path),
    indexable: route.hidden !== true,
    head: headTags(route.meta, route.path, route.hidden === true),
    html: renderToString(<App route={route} />),
});

export const siteUrl = config.siteUrl;
export const logo = LOGO;

export const renderAll = (): RenderedPage[] => [...ROUTES, NOT_FOUND].map(render);
