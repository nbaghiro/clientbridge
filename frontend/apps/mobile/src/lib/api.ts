import { createApi } from "@clientbridge/api-client";
import Constants from "expo-constants";

import { getAccessToken } from "./auth";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
const baseUrl = extra.apiUrl ?? "http://localhost:8701";

export const api = createApi({ baseUrl, getToken: getAccessToken });
