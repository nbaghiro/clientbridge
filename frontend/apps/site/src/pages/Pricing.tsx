import { Icon } from "../art/Icon";
import { PageHead } from "../components/PageHead";
import { links } from "../config";
import { pricingPage } from "../content/pages";
import { Closing } from "../sections/Closing";

export function PricingPage() {
    const { plan, fees } = pricingPage;
    return (
        <>
            <PageHead
                eyebrow={pricingPage.eyebrow}
                title={pricingPage.title}
                lede={pricingPage.lede}
                seed={5}
            />
            <section className="pb-20">
                <div className="wrap">
                    <div className="card plan">
                        <div className="plan-head">
                            <h2 className="h3">{plan.name}</h2>
                            <div className="mono plan-price">
                                {plan.price}
                                <span className="muted text-base">{plan.per}</span>
                            </div>
                            <p className="xs muted mt-1">{plan.note}</p>
                            <p className="body mt-4">{plan.seat}</p>
                            <a className="btn btn-primary btn-lg mt-6" href={links.startFree}>
                                {plan.cta}
                            </a>
                        </div>
                        <div className="plan-groups">
                            {plan.groups.map((g) => (
                                <div key={g.title}>
                                    <h3 className="eyebrow">{g.title}</h3>
                                    <ul className="list mt-4">
                                        {g.items.map((item) => (
                                            <li key={item}>
                                                <Icon name="check" className="tick" />
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
            <section className="band band-bg">
                <div className="wrap">
                    <div className="narrow">
                        <h2 className="h2">{fees.title}</h2>
                        <p className="lede mt-4">{fees.lede}</p>
                    </div>
                    <dl className="fees">
                        {fees.rows.map((r) => (
                            <div key={r.label}>
                                <dt>{r.label}</dt>
                                <dd>{r.value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </section>
            <section className="band">
                <div className="wrap narrow">
                    <h2 className="h2">{pricingPage.faqTitle}</h2>
                    <div className="faq">
                        {pricingPage.faq.map((item) => (
                            <details key={item.q}>
                                <summary>{item.q}</summary>
                                <p>{item.a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>
            <Closing copy={pricingPage.closing} />
        </>
    );
}
