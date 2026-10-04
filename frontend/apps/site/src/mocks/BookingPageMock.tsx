import type { CSSProperties } from "react";

import { bookingPage, demoBusiness } from "../content/demo";

/** The public booking page (Connect) in the demo business's own brand colour. */
export function BookingPageMock() {
    const brand = {
        "--accent": demoBusiness.brandColor,
        "--accent-strong": demoBusiness.brandColor,
        "--accent-weak": demoBusiness.tint,
        "--accent-line": demoBusiness.tint,
        "--accent-ink": "#ffffff",
    } as CSSProperties;
    return (
        <div className="mock pub" style={brand} aria-hidden="true">
            <div className="biz">
                <img src={demoBusiness.lockup} alt="" width={148} height={40} />
                <span className="tag">{demoBusiness.tag}</span>
            </div>
            {bookingPage.services.map((s, i) => (
                <div key={s.name} className={`opt${i === 0 ? " on" : ""}`}>
                    <img src={s.image} alt="" width={36} height={36} loading="lazy" />
                    <div>
                        <div className="font-medium">{s.name}</div>
                        <div className="xs muted">{s.length}</div>
                    </div>
                    <span className="p">{s.price}</span>
                </div>
            ))}
            <div className="xs muted mt-3.5">{bookingPage.date}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
                {bookingPage.times.map((t, i) => (
                    <span
                        key={t}
                        className={`pill ${i === bookingPage.selectedTime ? "pill-accent" : "pill-muted"} px-2.5 py-1 text-xs`}
                    >
                        {t}
                    </span>
                ))}
            </div>
            <div className="fullbtn">{bookingPage.cta}</div>
        </div>
    );
}
