export interface CalendarEvent {
    id: string;
    sessionId: string;
    bookingId: string | null;
    start: Date;
    end: Date;
    title: string;
    subtitle: string;
    status: string;
    staffId: string;
    color: string | null;
    capacity: number;
    bookedCount: number;
}

export interface PositionedEvent {
    event: CalendarEvent;
    topPx: number;
    heightPx: number;
    leftPct: number;
    widthPct: number;
    columnIndex: number;
    columnCount: number;
}

export type CalendarView = "day" | "week" | "month" | "agenda" | "staff";
