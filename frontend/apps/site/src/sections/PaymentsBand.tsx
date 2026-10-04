import { ContourField } from "../art/Art";
import { payments } from "../content/home";

export function PaymentsBand() {
    return (
        <section className="band band-bg band-art" id="payments">
            <div className="art-layer">
                <ContourField name="band" className="art-topo band-topo" />
            </div>
            <div className="wrap">
                <div className="narrow">
                    <p className="eyebrow">{payments.eyebrow}</p>
                    <h2 className="h2 mt-3">{payments.title}</h2>
                    <p className="lede mt-4">{payments.lede}</p>
                </div>
                <ol className="steps">
                    {payments.steps.map((s, i) => (
                        <li key={s.title} className="card step">
                            <div className="num">{String(i + 1).padStart(2, "0")}</div>
                            <h3 className="h3">{s.title}</h3>
                            <p className="soft">{s.body}</p>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
