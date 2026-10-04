import { LineIcon } from "../art/LineIcon";
import { TradeGlyph } from "../art/TradeGlyph";
import { PageHead } from "../components/PageHead";
import { featuresPage } from "../content/pages";
import { Closing } from "../sections/Closing";

export function FeaturesPage() {
    return (
        <>
            <PageHead
                eyebrow={featuresPage.eyebrow}
                title={featuresPage.title}
                lede={featuresPage.lede}
                seed={7}
            />
            <section className="pb-20">
                <div className="wrap feature-index">
                    {featuresPage.groups.map((g) => (
                        <article key={g.id} id={g.id} className="feature-group">
                            <LineIcon name={g.icon} />
                            <div>
                                <h2 className="h3">{g.title}</h2>
                                <p className="body mt-2">{g.body}</p>
                                <ul className="feature-items mt-4">
                                    {g.items.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                                <a className="more-link mt-4" href={g.link.href}>
                                    {g.link.label}
                                </a>
                            </div>
                        </article>
                    ))}
                </div>
            </section>
            <section className="band band-bg">
                <div className="wrap">
                    <h2 className="h2">{featuresPage.tradesTitle}</h2>
                    <div className="trade-links">
                        {featuresPage.trades.map((t) => (
                            <a key={t.href} href={t.href}>
                                <TradeGlyph name={t.glyph} />
                                {t.label}
                            </a>
                        ))}
                    </div>
                </div>
            </section>
            <Closing />
        </>
    );
}
