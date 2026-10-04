/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SITE_URL?: string;
    readonly VITE_APP_URL?: string;
    readonly VITE_BOOK_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
