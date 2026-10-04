import { TradeGlyph } from "../art/TradeGlyph";
import { Icon } from "../components/Icon";
import { Photo } from "../components/Photo";
import { BRANDS } from "../content/brands";
import { solutionsPage } from "../content/solutions";
import { solutionPath, TRADES } from "../content/trades";

/** One card per trade: its photo with the example business's avatar, and a line about it. */
export function SolutionCards() {
    return (
        <div className="sol-grid">
            {TRADES.map((t) => (
                <a key={t.slug} className="sol-card card" href={solutionPath(t.slug)}>
                    <figure className="photo">
                        <Photo
                            name={t.photo.name}
                            alt={t.photo.alt}
                            position={t.photo.position}
                            sizes="(max-width: 600px) 100vw, (max-width: 960px) 50vw, (max-width: 1100px) 33vw, 300px"
                        />
                        <img
                            className="sol-ava"
                            src={BRANDS[t.slug].avatar}
                            alt=""
                            width={40}
                            height={40}
                            loading="lazy"
                        />
                    </figure>
                    <div className="sol-body">
                        <div className="vmark small">
                            <TradeGlyph name={t.glyph} />
                        </div>
                        <h2 className="h3">{t.name}</h2>
                        <p className="body small">{t.oneLine}</p>
                        <span className="sol-link">
                            {solutionsPage.cardLink(t.who)}
                            <Icon name="arrow" />
                        </span>
                    </div>
                </a>
            ))}
        </div>
    );
}
