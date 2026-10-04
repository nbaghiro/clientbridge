import { calendar } from "../content/demo";

/** A five-day slice of the Schedule, as on the web app's week view. */
export function CalendarMock() {
    return (
        <div className="mock cal" aria-hidden="true">
            <div />
            {calendar.days.map((d) => (
                <div key={d.label} className={`dh${"today" in d ? " today" : ""}`}>
                    {d.label}
                    <b>{d.date}</b>
                </div>
            ))}
            <div className="hrs">
                {calendar.hours.map((h) => (
                    <span key={h}>{h}</span>
                ))}
            </div>
            {calendar.days.map((d, day) => (
                <div key={d.label} className="col">
                    {calendar.events
                        .filter((e) => e.day === day)
                        .map((e) => (
                            <div
                                key={e.client}
                                className={`ev${e.accent ? " b" : ""}`}
                                style={{ top: e.top, height: e.height }}
                            >
                                <div className="n">{e.client}</div>
                                <div className="s">{e.detail}</div>
                            </div>
                        ))}
                </div>
            ))}
        </div>
    );
}
