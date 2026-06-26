import { createApi } from "@clientbridge/api-client";

import { getAccessToken } from "./auth";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";

export const api = createApi({ baseUrl, getToken: () => Promise.resolve(getAccessToken()) });
