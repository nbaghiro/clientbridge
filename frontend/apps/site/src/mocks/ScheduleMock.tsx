import type { CSSProperties } from "react";

import type { Schedule } from "../content/trades";
import { tradePage } from "../content/solutions";

const ROW = 44;
const HOURS = 6;

const hourLabel = (h: number): string =>
    h === 12 ? "12 p.m." : h > 12 ? `${String(h - 12)} p.m.` : `${String(h)} a.m.`;

/** A day of the web app's Schedule, one column per staff member or room. */
export function ScheduleMock({ schedule, business }: { schedule: Schedule; business: string }) {
    const start = schedule.startHour ?? 9;
    return (
        <div className="mock card dayview" aria-hidden="true">
            <div className="dv-top">
                <div>
                    <div className="m-title text-base">{tradePage.scheduleTitle}</div>
                    <div className="m-sub">
                        {business} · {schedule.day}
                    </div>
                </div>
                <div className="seg">
                    {tradePage.scheduleViews.map((v, i) => (
                        <span key={v} className={i === 0 ? "on" : undefined}>
                            {v}
                        </span>
                    ))}
                </div>
            </div>
            <div className="cal" style={{ "--cols": schedule.columns.length } as CSSProperties}>
                <div />
                {schedule.columns.map(([name, role]) => (
                    <div key={name} className="dh">
                        <b>{name}</b>
                        {role}
                    </div>
                ))}
                <div className="hrs">
                    {Array.from({ length: HOURS }, (_, i) => (
                        <span key={i}>{hourLabel(start + i)}</span>
                    ))}
                </div>
                {schedule.columns.map(([name], column) => (
                    <div key={name} className="col" style={{ height: HOURS * ROW }}>
                        {schedule.events
                            .filter((e) => e.column === column)
                            .map((e) => (
                                <div
                                    key={`${e.title}-${String(e.start)}`}
                                    className={`ev${e.variant === "alt" ? " b" : e.variant === "open" ? " o" : ""}`}
                                    style={{
                                        top: Math.round(e.start * ROW) + 2,
                                        height: Math.round(e.hours * ROW) - 4,
                                    }}
                                >
                                    <div className="n">{e.title}</div>
                                    {e.detail ? <div className="s">{e.detail}</div> : null}
                                </div>
                            ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
