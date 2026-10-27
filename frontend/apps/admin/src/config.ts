import { runtimeConfig } from "@clientbridge/app-core";

const served = runtimeConfig();

export const config = {
    apiUrl: served.apiUrl,
    webUrl: served.webUrl,
};
