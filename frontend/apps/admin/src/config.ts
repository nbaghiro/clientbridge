import { runtimeConfig } from "@clientbridge/app-core";

const deployed = runtimeConfig();

export const config = {
    apiUrl: deployed?.apiUrl ?? import.meta.env.VITE_API_URL ?? "http://localhost:8701",
    webUrl: deployed?.webUrl ?? import.meta.env.VITE_WEB_URL ?? "http://localhost:8700",
};
