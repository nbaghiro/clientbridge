import { expect, test } from "@playwright/test";

import { deployment } from "./support/deployment";

const auth = `${deployment.api}/auth`;

test.describe("auth gateway", () => {
    test("recovery codes are throttled per address once a minute's tries run out", async ({
        request,
    }) => {
        const flow = await request.get(`${auth}/self-service/recovery/api`);
        expect(flow.status(), await flow.text()).toBe(200);
        const { id } = (await flow.json()) as { id: string };
        const statuses: number[] = [];
        // the edge counts approximately, so the check sends until it is refused rather than exactly eleven
        for (let attempt = 0; attempt < 30 && !statuses.includes(429); attempt++) {
            const sent = await request.post(`${auth}/self-service/recovery?flow=${id}`, {
                data: { method: "code", email: "nobody@smoke.example" },
            });
            statuses.push(sent.status());
        }
        expect(statuses[0]).not.toBe(429);
        expect(statuses).toContain(429);
    });

    test("Google sign-in starts at Google with this deployment's client and callback", async ({
        request,
    }) => {
        const flow = await request.get(`${auth}/self-service/login/browser`, {
            headers: { Accept: "application/json" },
        });
        expect(flow.status(), await flow.text()).toBe(200);
        const { id, ui } = (await flow.json()) as {
            id: string;
            ui: { nodes: { attributes: { name?: string; value?: unknown } }[] };
        };
        const csrf = ui.nodes.find((node) => node.attributes.name === "csrf_token")?.attributes
            .value;
        const started = await request.post(`${auth}/self-service/login?flow=${id}`, {
            headers: { Accept: "application/json" },
            data: { method: "oidc", provider: "google", csrf_token: csrf },
        });
        expect(started.status(), await started.text()).toBe(422);
        const target = new URL(
            ((await started.json()) as { redirect_browser_to: string }).redirect_browser_to,
        );
        expect(target.origin).toBe("https://accounts.google.com");
        expect(target.searchParams.get("client_id")).toMatch(/\.apps\.googleusercontent\.com$/);
        expect(target.searchParams.get("redirect_uri")).toBe(
            `${auth}/self-service/methods/oidc/callback/google`,
        );
        const google = await request.get(target.toString());
        const page = await google.text();
        expect(google.status()).toBeLessThan(400);
        expect(page).not.toContain("redirect_uri_mismatch");
        expect(page).not.toContain("invalid_client");
    });
});
