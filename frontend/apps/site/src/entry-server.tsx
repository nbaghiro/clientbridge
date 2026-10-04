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
    description: route.meta.description,
    ogImage: ogImageFor(route.path),
    indexable: route !== NOT_FOUND,
    head: headTags(route.meta, route.path),
    html: renderToString(<App route={route} />),
});

export const siteUrl = config.siteUrl;
export const logo = LOGO;

export const renderAll = (): RenderedPage[] => [...ROUTES, NOT_FOUND].map(render);
