// Where the site links out to; each deploy sets these (see .env.example).
const env = import.meta.env;

const trim = (url: string): string => url.replace(/\/+$/, "");

export const config = {
    siteUrl: trim(env.VITE_SITE_URL ?? "http://localhost:8710"),
    appUrl: trim(env.VITE_APP_URL ?? "http://localhost:8700"),
    bookUrl: trim(env.VITE_BOOK_URL ?? "http://localhost:8709"),
};

export const links = {
    signIn: `${config.appUrl}/`,
    startFree: `${config.appUrl}/`,
    demoBusiness: `${config.bookUrl}/book/birchbark`,
};
