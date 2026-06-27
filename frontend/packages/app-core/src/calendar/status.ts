export type CalendarIntent = "accent" | "success" | "warning" | "danger" | "neutral";

// The status → visual-intent decision is shared; each platform maps the intent to its own tokens.
export function statusIntent(status: string): CalendarIntent {
    switch (status) {
        case "confirmed":
            return "accent";
        case "completed":
            return "success";
        case "pending":
            return "warning";
        case "no_show":
            return "danger";
        default:
            return "neutral";
    }
}
