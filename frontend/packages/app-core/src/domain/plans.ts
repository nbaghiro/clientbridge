import { useRef, useState } from "react";

import { type ApiLike, type Attempt, failureMessage, sendAttempt } from "../api";
import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
import { formatMoney } from "../format";
import { useAsyncAction, useBusinessQuery as useQuery, useRemote } from "../hooks";
import { strings } from "../strings";
import type { Intent, NoticeTone } from "../ui";
import { useBusinessId } from "./business";

type PlanTier = "premium" | "team";
export type PlanInterval = "month" | "year";
type PlanAccess = "trial" | "active" | "past_due" | "lapsed";

interface PlanPrice {
    plan: PlanTier | null;
    interval: PlanInterval;
    amount_cents: number;
}

interface PlanState {
    access: PlanAccess;
    plan: PlanTier | null;
    plan_status: string;
    trial_ends_at: string;
    managed: boolean;
    interval: PlanInterval | null;
    seats: number;
    seat_cap: number;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    currency: string;
    prices: PlanPrice[];
}

const DAY_MS = 86_400_000;
// the shell warns the owner this many days before the trial ends
const TRIAL_WARNING_DAYS = 3;
const PLAN_TIERS: readonly PlanTier[] = ["premium", "team"];

const p = strings.plans;

const STATUS: Record<PlanAccess, () => string> = {
    trial: () => p.status.trial,
    active: () => p.status.active,
    past_due: () => p.status.past_due,
    lapsed: () => p.status.lapsed,
};

/** What the business may do now; mirrors the server's plan_access. */
export function planAccess(status: string, trialEndsAt: Date, now: Date): PlanAccess {
    if (status === "trialing") return now < trialEndsAt ? "trial" : "lapsed";
    if (status === "active" || status === "past_due") return status;
    return "lapsed";
}

/** Whole days left in the trial, counting a part day as one. */
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
    return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

const PLAN_SQL = "SELECT plan, plan_status, trial_ends_at FROM businesses LIMIT 1";

interface PlanRow {
    plan: string | null;
    plan_status: string | null;
    trial_ends_at: string | null;
}

/** The synced plan state, which every device reads offline; null until the row syncs. */
function usePlanAccess(): { access: PlanAccess; daysLeft: number } | null {
    const row = useQuery<PlanRow>(PLAN_SQL).data[0];
    if (row?.plan_status === null || row?.plan_status === undefined) return null;
    if (row.trial_ends_at === null) return null;
    const ends = parseTimestamp(row.trial_ends_at);
    const now = new Date();
    return { access: planAccess(row.plan_status, ends, now), daysLeft: trialDaysLeft(ends, now) };
}

interface PlanNotice {
    tone: NoticeTone;
    message: string;
    // the owner's way to the plan page; others only see the state
    action: string | null;
}

/** The shell's plan banner: paused or past due for everyone, a closing trial for the owner. */
export function planNotice(
    state: { access: PlanAccess; daysLeft: number } | null,
    role: string | null,
): PlanNotice | null {
    if (state === null) return null;
    const owner = role === "owner";
    if (state.access === "lapsed")
        return { tone: "danger", message: p.noticeLapsed, action: owner ? p.noticeChoose : null };
    if (state.access === "past_due")
        return { tone: "danger", message: p.noticePastDue, action: owner ? p.noticeFix : null };
    if (state.access === "trial" && owner && state.daysLeft <= TRIAL_WARNING_DAYS)
        return { tone: "info", message: p.noticeTrial(state.daysLeft), action: p.noticeChoose };
    return null;
}

export function usePlanNotice(role: string | null): PlanNotice | null {
    return planNotice(usePlanAccess(), role);
}

interface PlanTierView {
    plan: PlanTier;
    name: string;
    summary: string;
    price: string;
    staff: string;
    current: boolean;
    action: string;
}

export interface PlanView {
    phase: "loading" | "error" | "ready";
    refreshing: boolean;
    refresh: () => void;
    title: string;
    status: string;
    detail: string;
    intent: Intent;
    facts: { label: string; value: string }[];
    interval: PlanInterval;
    setInterval: (interval: PlanInterval) => void;
    intervals: { key: PlanInterval; label: string }[];
    tiers: PlanTierView[];
    taxNote: string;
    // Stripe bills a subscription: plan changes and the billing portal are available
    managed: boolean;
    choose: (plan: PlanTier) => void;
    manage: () => void;
    busy: boolean;
    error: string | null;
}

function priceOf(state: PlanState, plan: PlanTier | null, interval: PlanInterval): string {
    const row = state.prices.find((r) => r.plan === plan && r.interval === interval);
    return row === undefined ? "" : formatMoney(row.amount_cents, state.currency);
}

function tierName(plan: PlanTier): string {
    return plan === "premium" ? p.premium : p.team;
}

function headline(
    state: PlanState,
    zone: string,
    now: Date,
): Omit<
    PlanView,
    | "phase"
    | "status"
    | "refreshing"
    | "refresh"
    | "interval"
    | "setInterval"
    | "intervals"
    | "tiers"
    | "taxNote"
    | "managed"
    | "choose"
    | "manage"
    | "busy"
    | "error"
> {
    const ends = parseTimestamp(state.trial_ends_at);
    const name = state.plan === null ? "" : tierName(state.plan);
    const period =
        state.current_period_end === null ? null : parseTimestamp(state.current_period_end);
    const facts = [{ label: p.seatsLabel, value: p.seats(state.seats) }];
    if (period !== null)
        facts.push({
            label: state.cancel_at_period_end ? p.endsLabel : p.renewsLabel,
            value: formatDate(period, zone),
        });
    switch (state.access) {
        case "trial":
            return {
                title: p.trialTitle(trialDaysLeft(ends, now)),
                detail: p.trialBody(formatDate(ends, zone)),
                intent: "accent",
                facts,
            };
        case "lapsed":
            return { title: p.lapsedTitle, detail: p.lapsedBody, intent: "danger", facts };
        case "past_due":
            return { title: p.pastDueTitle, detail: p.pastDueBody, intent: "warning", facts };
        case "active":
            return {
                title: p.activeTitle(name),
                detail: state.managed ? p.activeBody : p.complimentary,
                intent: "success",
                facts,
            };
    }
}

/** The owner's plan page: the live plan from Stripe, both tiers and the Checkout and portal links. */
export function usePlan(api: ApiLike, open: (url: string) => void = () => undefined): PlanView {
    const zone = useBusinessZone();
    const businessId = useBusinessId();
    const remote = useRemote(() => api.get<PlanState>("/v1/plan"), businessId ?? "");
    const action = useAsyncAction();
    const [picked, setInterval] = useState<PlanInterval | null>(null);
    const attempt = useRef<Attempt | null>(null);
    const state = remote.data;
    const refresh = (): void => {
        remote.refresh().catch(() => undefined);
    };
    const interval = picked ?? state?.interval ?? "month";
    const managed = state?.managed ?? false;
    const choose = (plan: PlanTier): void => {
        const body = { plan, interval };
        const path = managed ? "/v1/plan/change" : "/v1/plan/checkout";
        const send = (key: string): Promise<{ url?: string }> =>
            api.post<{ url?: string }>(path, body, { idempotencyKey: key });
        if (managed) {
            action.run(() => sendAttempt(attempt, { path, body }, send), {
                onSuccess: refresh,
                errorMessage: (e) => failureMessage(e, p.changeError),
            });
            return;
        }
        action.run(
            async () => {
                const { url } = await sendAttempt(attempt, { path, body }, send);
                if (url !== undefined) open(url);
            },
            { errorMessage: (e) => failureMessage(e, p.checkoutError) },
        );
    };
    const manage = (): void => {
        action.run(
            async () => {
                open((await api.post<{ url: string }>("/v1/plan/portal", {})).url);
            },
            { errorMessage: (e) => failureMessage(e, p.portalError) },
        );
    };
    const phase = state !== null ? "ready" : remote.error !== null ? "error" : "loading";
    const view =
        state === null
            ? { title: "", status: "", detail: "", intent: "neutral" as Intent, facts: [] }
            : { ...headline(state, zone, new Date()), status: STATUS[state.access]() };
    return {
        phase,
        refreshing: remote.isLoading,
        refresh,
        ...view,
        interval,
        setInterval,
        intervals: [
            { key: "month", label: p.monthly },
            { key: "year", label: p.yearly },
        ],
        tiers:
            state === null
                ? []
                : PLAN_TIERS.map((plan) => {
                      const current = state.plan === plan && managed && state.interval === interval;
                      return {
                          plan,
                          name: tierName(plan),
                          summary: plan === "premium" ? p.premiumSummary : p.teamSummary,
                          price:
                              interval === "month"
                                  ? p.perMonth(priceOf(state, plan, "month"))
                                  : p.perYear(priceOf(state, plan, "year")),
                          staff:
                              plan === "premium"
                                  ? p.premiumStaff(priceOf(state, null, "month"))
                                  : p.teamStaff,
                          current,
                          action: managed ? p.switchTo(tierName(plan)) : p.choose(tierName(plan)),
                      };
                  }),
        taxNote: p.taxNote,
        managed,
        choose,
        manage,
        busy: action.busy,
        error: action.error,
    };
}

/** What one more team member costs the owner on Premium; empty on other plans or for admins. */
export function useSeatCost(api: ApiLike, role: string | null): string {
    const businessId = useBusinessId();
    const owner = role === "owner";
    const remote = useRemote(
        () => (owner ? api.get<PlanState>("/v1/plan") : Promise.resolve(null)),
        `${businessId ?? ""}:${String(owner)}`,
    );
    const state = remote.data;
    if (state?.plan !== "premium" || !state.managed) return "";
    return p.seatCost(priceOf(state, null, "month"));
}
