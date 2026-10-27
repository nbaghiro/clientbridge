/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SITE_URL?: string;
    readonly VITE_APP_URL?: string;
    readonly VITE_PAGE_URL?: string;
    readonly VITE_WAITLIST?: string;
    readonly VITE_DEMO_NAMESPACE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
