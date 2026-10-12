import { formatMoney } from "@clientbridge/app-core/public";

// Matches the backend's PLAN_PRICES, which Stripe bills; a year costs ten months.
const CURRENCY = "CAD";
const CENTS = {
    premium: { month: 4999, year: 49990 },
    team: { month: 9999, year: 99990 },
    seat: 1000,
} as const;

export const planPrices = {
    premium: {
        month: formatMoney(CENTS.premium.month, CURRENCY),
        year: formatMoney(CENTS.premium.year, CURRENCY),
    },
    team: {
        month: formatMoney(CENTS.team.month, CURRENCY),
        year: formatMoney(CENTS.team.year, CURRENCY),
    },
    seat: formatMoney(CENTS.seat, CURRENCY),
};
