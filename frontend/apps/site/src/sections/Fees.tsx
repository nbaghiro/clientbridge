import type { ReactNode } from "react";

import { pricingPage } from "../content/pages";

/** The payment fees, shown the same way on the pricing and payments pages. */
export function Fees({ children }: { children?: ReactNode }) {
    const { fees } = pricingPage;
    return (
        <section className="band band-bg">
            <div className="wrap">
                <div className="narrow">
                    <h2 className="h2">{fees.title}</h2>
                    <p className="lede mt-4">{fees.lede}</p>
                </div>
                <dl className="fees">
                    {fees.rows.map((r) => (
                        <div key={r.label}>
                            <dt>{r.label}</dt>
                            <dd>{r.value}</dd>
                        </div>
                    ))}
                </dl>
                {children}
            </div>
        </section>
    );
}
