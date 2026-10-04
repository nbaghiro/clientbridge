import { proof } from "../content/home";

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
                        <figure key={t.lead} className="placeholder m-0">
                            <p>
                                <b>{t.lead}</b> {t.body}
                            </p>
                            <figcaption className="xs mt-3">{t.byline}</figcaption>
                        </figure>
                    ))}
                </div>
            </div>
        </section>
    );
}
