import { Icon } from "../art/Icon";
import { PageHead } from "../components/PageHead";
import { links } from "../config";
import { pricingPage } from "../content/pages";
import { Closing } from "../sections/Closing";
import { Faq } from "../sections/Faq";
import { Fees } from "../sections/Fees";

export function PricingPage() {
    const { included } = pricingPage;
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
                    <div className="plans">
                        {pricingPage.plans.map((plan) => (
                            <div className="card plan-tier" key={plan.name}>
                                <h2 className="h3">{plan.name}</h2>
                                <p className="body muted mt-2">{plan.summary}</p>
                                <div className="mono plan-price">
                                    {plan.price}
                                    <span className="muted text-base">{plan.per}</span>
                                </div>
                                <p className="xs muted mt-1">{plan.yearly}</p>
                                <p className="body mt-4">{plan.staff}</p>
                                <a className="btn btn-primary btn-lg mt-6" href={links.startFree}>
                                    {pricingPage.cta}
                                </a>
                            </div>
                        ))}
                    </div>
                    <p className="xs muted mt-4">{pricingPage.trial}</p>
                    <div className="card plan mt-8">
                        <h2 className="h3">{included.title}</h2>
                        <div className="plan-groups">
                            {included.groups.map((g) => (
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
            <Fees />
            <Faq title={pricingPage.faqTitle} items={pricingPage.faq} />
            <Closing copy={pricingPage.closing} />
        </>
    );
}
