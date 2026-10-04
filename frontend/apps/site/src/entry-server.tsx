import { renderToString } from "react-dom/server";

import { App } from "./App";
import { headTags } from "./head";
import { fileFor, NOT_FOUND, ROUTES, type SiteRoute } from "./routes";

export interface RenderedPage {
    file: string;
    head: string;
    html: string;
}

const render = (route: SiteRoute): RenderedPage => ({
    file: fileFor(route),
    head: headTags(route.meta, route.path),
    html: renderToString(<App route={route} />),
});

export const renderAll = (): RenderedPage[] => [...ROUTES, NOT_FOUND].map(render);
