// Where the site links out to; each deploy sets these (see .env.example).
const env = import.meta.env;

const trim = (url: string): string => url.replace(/\/+$/, "");

export const config = {
    siteUrl: trim(env.VITE_SITE_URL ?? "http://localhost:8710"),
    appUrl: trim(env.VITE_APP_URL ?? "http://localhost:8700"),
    bookUrl: trim(env.VITE_BOOK_URL ?? "http://localhost:8709"),
    // the site deployed before the app: sign-ups join the waitlist and nothing links to the app
    waitlist: env.VITE_WAITLIST === "1",
};

// the seeded demo business that shows each trade, by its booking page slug
export type DemoSlug =
    | "birchbark"
    | "maplemain"
    | "ridgeline"
    | "brightwater"
    | "lakeside"
    | "harbourside"
    | "fieldnote"
    | "northlight";

export const demoBusinessLink = (slug: DemoSlug): string | null =>
    config.waitlist ? null : `${config.bookUrl}/b/${slug}`;

export const links = {
    signIn: config.waitlist ? null : `${config.appUrl}/`,
    startFree: config.waitlist ? "/waitlist" : `${config.appUrl}/`,
    demoBusiness: demoBusinessLink("birchbark"),
};
