import { addDays, dateKey } from "./datetime";
import type { CalendarEvent, PositionedEvent } from "./types";

export interface LayoutOptions {
    dayStart: Date;
    pxPerMin: number;
    minHeightPx?: number;
    gapPx?: number;
}

// Overlapping events chain into a group, then split into first-fit columns so none visually overlap.
export function layoutDay(events: CalendarEvent[], opts: LayoutOptions): PositionedEvent[] {
    const { dayStart, pxPerMin, minHeightPx = 18, gapPx = 1 } = opts;
    const dayEnd = addDays(dayStart, 1);
    const dayStartMs = dayStart.getTime();

    const inDay = events
        .filter((e) => e.start < dayEnd && e.end > dayStart)
        .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());

    const out: PositionedEvent[] = [];
    let group: CalendarEvent[] = [];
    let groupMaxEnd = 0;

    const flush = (): void => {
        if (group.length === 0) return;
        const colEnds: number[] = [];
        const colOf = new Map<string, number>();
        for (const e of group) {
            const startMs = e.start.getTime();
            let col = -1;
            for (let c = 0; c < colEnds.length; c++) {
                const end = colEnds[c];
                if (end !== undefined && end <= startMs) {
                    col = c;
                    break;
                }
            }
            if (col === -1) {
                col = colEnds.length;
                colEnds.push(e.end.getTime());
            } else {
                colEnds[col] = e.end.getTime();
            }
            colOf.set(e.id, col);
        }
        const colCount = colEnds.length;
        for (const e of group) {
            const col = colOf.get(e.id) ?? 0;
            const startMin = Math.max(0, (e.start.getTime() - dayStartMs) / 60_000);
            const endMin = Math.min(1440, (e.end.getTime() - dayStartMs) / 60_000);
            out.push({
                event: e,
                topPx: startMin * pxPerMin,
                heightPx: Math.max((endMin - startMin) * pxPerMin - gapPx, minHeightPx),
                leftPct: (col / colCount) * 100,
                widthPct: (1 / colCount) * 100,
                columnIndex: col,
                columnCount: colCount,
            });
        }
        group = [];
        groupMaxEnd = 0;
    };

    for (const e of inDay) {
        if (group.length > 0 && e.start.getTime() >= groupMaxEnd) flush();
        group.push(e);
        groupMaxEnd = Math.max(groupMaxEnd, e.end.getTime());
    }
    flush();
    return out;
}

export function groupByStaff(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
        const list = map.get(e.staffId) ?? [];
        list.push(e);
        map.set(e.staffId, list);
    }
    return map;
}

export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
        const key = dateKey(e.start);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
    }
    return map;
}

/** The hour window to render — default business hours, auto-expanded to fit any out-of-range event. */
export function dayBounds(
    events: CalendarEvent[],
    defaultStartHour = 7,
    defaultEndHour = 19,
): { startHour: number; endHour: number } {
    let startHour = defaultStartHour;
    let endHour = defaultEndHour;
    for (const e of events) {
        startHour = Math.min(startHour, e.start.getHours());
        endHour = Math.max(
            endHour,
            e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours(),
        );
    }
    return {
        startHour: Math.max(0, startHour),
        endHour: Math.min(24, Math.max(endHour, startHour + 1)),
    };
}

export function snapMinutes(min: number, step = 5): number {
    return Math.round(min / step) * step;
}

export function dragToStart(
    originalStart: Date,
    deltaPx: number,
    pxPerMin: number,
    step = 5,
): Date {
    const deltaMin = snapMinutes(deltaPx / pxPerMin, step);
    return new Date(originalStart.getTime() + deltaMin * 60_000);
}
