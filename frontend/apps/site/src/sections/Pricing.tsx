import { Icon } from "../art/Icon";
import { links } from "../config";
import { pricing } from "../content/home";

export function Pricing() {
    return (
        <section className="band" id="pricing">
            <div className="wrap">
                <div className="card price">
                    <div>
                        <p className="eyebrow">{pricing.eyebrow}</p>
                        <h2 className="h2 mt-3">{pricing.title}</h2>
                        <p className="body mt-4">{pricing.body}</p>
                    </div>
                    <div className="right">
                        <div className="mono text-[40px] font-semibold tracking-[-0.02em]">
                            {pricing.price}
                            <span className="muted text-base">{pricing.per}</span>
                        </div>
                        <p className="xs muted mt-1">{pricing.note}</p>
                        <ul className="list mt-5">
                            {pricing.points.map((p) => (
                                <li key={p}>
                                    <Icon name="check" className="tick" />
                                    {p}
                                </li>
                            ))}
                        </ul>
                        <a className="btn btn-primary mt-6" href={links.startFree}>
                            {pricing.cta}
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
