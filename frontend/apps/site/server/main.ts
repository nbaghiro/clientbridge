import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    createSite,
    resendConfirmation,
    apiContact,
    resendWaitlist,
    type WaitlistEmails,
} from "./site.ts";

const apiKey = process.env.RESEND_API_KEY ?? "";
const segmentId = process.env.RESEND_SEGMENT_ID ?? "";
const from = process.env.EMAIL_FROM ?? "";
const apiUrl = process.env.VITE_API_URL ?? "http://localhost:8701";
const siteUrl = (process.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
if (!apiKey || !segmentId || !from || !siteUrl) {
    throw new Error("RESEND_API_KEY, RESEND_SEGMENT_ID, EMAIL_FROM and VITE_SITE_URL must be set");
}

const here = dirname(fileURLToPath(import.meta.url));
const confirmation = JSON.parse(
    readFileSync(join(here, "waitlist-email.json"), "utf8"),
) as WaitlistEmails;

const port = Number(process.env.PORT ?? "8710");
const server = createSite({
    dist: join(here, "..", "dist"),
    siteUrl,
    join: resendWaitlist(apiKey, segmentId),
    confirm: resendConfirmation(apiKey, from, confirmation),
    contact: apiContact(apiUrl),
});
server.listen(port, () => {
    process.stdout.write(`site: serving on :${String(port)}\n`);
});
process.on("SIGTERM", () => {
    server.close();
});
