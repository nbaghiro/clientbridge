import { ContourField } from "../art/Art";
import { LineIcon, type LineIconName } from "../art/LineIcon";
import { payments } from "../content/home";

const STEP_ICONS: readonly LineIconName[] = ["tapToPay", "invoice", "payout", "tax"];

/** The four steps of a payment on one line, from the client's card to the tax return. */
export function PaymentFlow({ id, link = false }: { id: string; link?: boolean }) {
    return (
        <section className="band band-bg band-art" id={id}>
            <div className="art-layer">
                <ContourField name="band" className="art-topo band-topo" />
            </div>
            <div className="wrap">
                <div className="narrow">
                    <p className="eyebrow">{payments.eyebrow}</p>
                    <h2 className="h2 mt-3">{payments.title}</h2>
                    <p className="lede mt-4">{payments.lede}</p>
                </div>
                <ol className="flow">
                    {payments.steps.map((step, i) => (
                        <li key={step.title} className="flow-step">
                            <span className="flow-node">
                                <LineIcon name={STEP_ICONS[i] ?? "payout"} />
                            </span>
                            <div>
                                <div className="flow-num">{String(i + 1).padStart(2, "0")}</div>
                                <h3 className="h3">{step.title}</h3>
                                <p>{step.body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
                {link ? (
                    <a className="btn btn-ghost mt-10" href="/payments">
                        {payments.link}
                    </a>
                ) : null}
            </div>
        </section>
    );
}
