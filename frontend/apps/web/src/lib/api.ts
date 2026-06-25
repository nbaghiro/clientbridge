import { createApi } from "@clientbridge/api-client";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";

export const api = createApi({ baseUrl });
