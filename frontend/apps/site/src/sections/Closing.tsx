import { ArcMark } from "../art/Art";
import { links } from "../config";
import { closing } from "../content/home";

export function Closing({
    copy = closing,
    demo = links.demoBusiness,
}: {
    copy?: typeof closing;
    demo?: string | null;
}) {
    return (
        <section className="band band-bg band-line final">
            <div className="wrap narrow mx-auto">
                <ArcMark seed={3} />
                <h2 className="h2">{copy.title}</h2>
                <p className="lede mt-4">{copy.lede}</p>
                <div className="cta-row">
                    <a className="btn btn-primary btn-lg" href={links.startFree}>
                        {copy.primary}
                    </a>
                    {demo === null ? null : (
                        <a className="btn btn-ghost btn-lg" href={demo}>
                            {copy.secondary}
                        </a>
                    )}
                </div>
            </div>
        </section>
    );
}
