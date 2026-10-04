import type { ComponentType } from "react";

import { homeMeta } from "./content/home";
import { notFound } from "./content/site";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";

export interface PageMeta {
    title: string;
    description: string;
}

export interface SiteRoute {
    path: string;
    Page: ComponentType;
    meta: PageMeta;
}

/** Every page of the site. The build writes one HTML file per entry (see scripts/prerender.ts). */
export const ROUTES: readonly SiteRoute[] = [{ path: "/", Page: Home, meta: homeMeta }];

export const NOT_FOUND: SiteRoute = {
    path: "/404",
    Page: NotFound,
    meta: { title: `${notFound.title} | Clientbridge`, description: notFound.body },
};

export const routeFor = (path: string): SiteRoute => {
    const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
    return ROUTES.find((r) => r.path === clean) ?? NOT_FOUND;
};

/** The output file for a route: "/" → index.html, "/solutions" → solutions/index.html. */
export const fileFor = (route: SiteRoute): string =>
    route === NOT_FOUND
        ? "404.html"
        : `${route.path.replace(/^\//, "")}${route.path === "/" ? "" : "/"}index.html`;
