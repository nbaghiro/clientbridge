import { ContourField } from "../art/Art";
import { links } from "../config";
import { hero } from "../content/home";
import { AppWindow } from "../mocks/AppWindow";
import { Laptop } from "../mocks/Laptop";
import { PhoneAndroid } from "../mocks/PhoneAndroid";

/** The web app on a laptop with the mobile app's Payments screen overlapping its right edge. */
function DeviceShowcase() {
    return (
        <div className="trio">
            <div className="trio-web">
                <Laptop>
                    <AppWindow />
                </Laptop>
            </div>
            <div className="trio-phone">
                <PhoneAndroid />
            </div>
        </div>
    );
}

export function Hero() {
    return (
        <section className="hero">
            <div className="art-layer">
                <ContourField name="hero" />
            </div>
            <div className="wrap">
                <p className="eyebrow accent">{hero.eyebrow}</p>
                <h1 className="h1">
                    {hero.title[0]} <span className="h1-line">{hero.title[1]}</span>
                </h1>
                <p className="lede">{hero.lede}</p>
                <div className="cta-row">
                    <a className="btn btn-primary btn-lg" href={links.startFree}>
                        {hero.primary}
                    </a>
                    <a className="btn btn-ghost btn-lg" href={links.demoBusiness}>
                        {hero.secondary}
                    </a>
                </div>
                <p className="note">{hero.note}</p>
                <DeviceShowcase />
            </div>
        </section>
    );
}
