import { ArcMark } from "../art/Art";
import { links } from "../config";
import { closing } from "../content/home";

export function Closing() {
    return (
        <section className="band band-bg band-line final">
            <div className="wrap narrow mx-auto">
                <ArcMark seed={3} />
                <h2 className="h2">{closing.title}</h2>
                <p className="lede mt-4">{closing.lede}</p>
                <div className="cta-row">
                    <a className="btn btn-primary btn-lg" href={links.startFree}>
                        {closing.primary}
                    </a>
                    <a className="btn btn-ghost btn-lg" href={links.demoBusiness}>
                        {closing.secondary}
                    </a>
                </div>
            </div>
        </section>
    );
}
