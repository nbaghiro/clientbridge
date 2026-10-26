import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { newAccount } from "../identity";
import { bookingApi } from "./bookings";
import { requireLocalMail } from "./evidence";
import { openBusiness, signUp } from "./onboarding";

const execute = promisify(execFile);

export interface OwnedBusiness {
    account: ReturnType<typeof newAccount>;
    id: string;
    slug: string;
    name: string;
    timezone: string;
}

/** Signs a new owner up and opens a business of their own, so plan and team state are the run's. */
export async function ownBusiness(
    page: Page,
    request: APIRequestContext,
    name: string,
): Promise<OwnedBusiness> {
    requireLocalMail();
    const account = { ...newAccount("team-owner"), name: demoPerson(randomUUID()) };
    await signUp(page, request, account);
    const created = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/onboarding" &&
            response.request().method() === "POST",
    );
    await openBusiness(page, name);
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const body = (await response.json()) as { id: string; slug: string; timezone: string };
    return { account, id: body.id, slug: body.slug, name, timezone: body.timezone };
}

export interface PlanView {
    access: string;
    plan: string | null;
    plan_status: string;
    seats: number;
    seat_cap: number | null;
}

export async function planView(page: Page): Promise<PlanView> {
    const response = await page.request.get(`${bookingApi()}/v1/plan`);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as PlanView;
}

/** Applies a stand-in Stripe subscription through the app's own plan mirror (e2e.actions plan). */
export async function standInPlan(
    businessId: string,
    status: "active" | "canceled",
): Promise<{ plan_status: string; plan: string | null; changed: boolean }> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.actions", "plan", businessId, status],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as { plan_status: string; plan: string | null; changed: boolean };
}
