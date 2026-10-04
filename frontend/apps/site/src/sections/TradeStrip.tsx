import { ArcMark } from "../art/Art";
import { TradeGlyph } from "../art/TradeGlyph";
import { Icon } from "../components/Icon";
import { solutionsIntro } from "../content/home";
import { solutionPath, TRADES } from "../content/trades";

export function TradeStrip() {
    return (
        <section className="band" id="solutions">
            <div className="wrap">
                <div className="narrow">
                    <ArcMark seed={9} width={88} />
                    <p className="eyebrow mt-4">{solutionsIntro.eyebrow}</p>
                    <h2 className="h2 mt-3">{solutionsIntro.title}</h2>
                    <p className="lede mt-4">{solutionsIntro.lede}</p>
                </div>
                <div className="trade-grid">
                    {TRADES.map((t) => (
                        <a key={t.slug} className="trade-tile" href={solutionPath(t.slug)}>
                            <TradeGlyph name={t.glyph} />
                            <span>{t.name}</span>
                            <Icon name="arrow" />
                        </a>
                    ))}
                </div>
            </div>
        </section>
    );
}
