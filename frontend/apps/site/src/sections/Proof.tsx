import { proof, type TestimonialCopy } from "../content/home";

export function Proof() {
    return (
        <section className="band band-bg">
            <div className="wrap stack-24">
                <div className="narrow">
                    <p className="eyebrow">{proof.eyebrow}</p>
                </div>
                <div className="logo-row">
                    {Array.from({ length: proof.logoCount }, (_, i) => (
                        <div key={i} className="logo-ph">
                            {proof.logo}
                        </div>
                    ))}
                </div>
                <div className="grid-3">
                    {proof.testimonials.map((t) => (
                        <Testimonial key={t.lead} quote={t} />
                    ))}
                </div>
            </div>
        </section>
    );
}

/** A clearly marked stand-in until real, approved quotes are in. */
export function Testimonial({ quote }: { quote: TestimonialCopy }) {
    return (
        <figure className="placeholder m-0">
            <p>
                <b>{quote.lead}</b> {quote.body}
            </p>
            <figcaption className="xs mt-3">{quote.byline}</figcaption>
        </figure>
    );
}
