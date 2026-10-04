import { type Brand, BRANDS, brandStyle } from "../content/brands";
import { bookingPage, demoBusiness } from "../content/demo";

export interface BookingPageData {
    tag: string;
    items: readonly { name: string; detail: string; price: string; image?: string }[];
    date: string;
    times: readonly string[];
    selectedTime: number;
    cta: string;
}

const HOME: BookingPageData = {
    tag: demoBusiness.tag,
    items: bookingPage.services.map((s) => ({
        name: s.name,
        detail: s.length,
        price: s.price,
        image: s.image,
    })),
    date: bookingPage.date,
    times: bookingPage.times,
    selectedTime: bookingPage.selectedTime,
    cta: bookingPage.cta,
};

/** The public booking page (Connect) in a business's own logo and colour. */
export function BookingPageMock({
    brand = BRANDS["pet-grooming"],
    page = HOME,
}: {
    brand?: Brand;
    page?: BookingPageData;
}) {
    return (
        <div className="mock pub" style={brandStyle(brand)} aria-hidden="true">
            <div className="biz">
                <img src={brand.lockup} alt="" width={Math.round(40 * brand.aspect)} height={40} />
                <span className="tag">{page.tag}</span>
            </div>
            {page.items.map((s, i) => (
                <div key={`${s.name}-${s.detail}`} className={`opt${i === 0 ? " on" : ""}`}>
                    {s.image ? (
                        <img src={s.image} alt="" width={36} height={36} loading="lazy" />
                    ) : (
                        <span className="radio" />
                    )}
                    <div>
                        <div className="font-medium">{s.name}</div>
                        <div className="xs muted">{s.detail}</div>
                    </div>
                    <span className="p">{s.price}</span>
                </div>
            ))}
            <div className="xs muted mt-3.5">{page.date}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
                {page.times.map((t, i) => (
                    <span
                        key={t}
                        className={`pill ${i === page.selectedTime ? "pill-accent" : "pill-muted"} px-2.5 py-1 text-xs`}
                    >
                        {t}
                    </span>
                ))}
            </div>
            <div className="fullbtn">{page.cta}</div>
        </div>
    );
}
