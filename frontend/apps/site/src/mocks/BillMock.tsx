import type { Brand } from "../content/brands";
import { tradePage } from "../content/solutions";
import type { Bill } from "../content/trades";
import { money, taxOn } from "../format";

/** An invoice or estimate as the client sees it, from the example business. */
export function BillMock({ bill, brand }: { bill: Bill; brand: Brand }) {
    const subtotal = bill.lines.reduce((sum, [, cents]) => sum + cents, 0);
    const taxes = bill.taxes.map(([label, rate]) => [label, taxOn(subtotal, rate)] as const);
    const total = subtotal + taxes.reduce((sum, [, cents]) => sum + cents, 0);
    const retainer = bill.retainerPct ? Math.round(total * bill.retainerPct) : 0;
    const row = (label: string, cents: number, cls = "", sign = "") => (
        <div key={label} className={`sumrow${cls}`}>
            <span>{label}</span>
            <span className="mono">
                {sign}
                {money(cents)}
            </span>
        </div>
    );
    return (
        <div className="mock pub" aria-hidden="true">
            <div className="inv-head">
                <div className="inv-biz">
                    <img className="biz-ava" src={brand.avatar} alt="" width={36} height={36} />
                    <div>
                        <div className="font-semibold">{brand.name}</div>
                        <div className="xs muted">{brand.city}</div>
                    </div>
                </div>
                <span className={`pill pill-${bill.status.tone}`}>{bill.status.text}</span>
            </div>
            <div className="xs muted mt-3.5 mb-2">{bill.meta}</div>
            {bill.lines.map(([label, cents]) => row(label, cents))}
            {row(tradePage.subtotal, subtotal, " sub")}
            {taxes.map(([label, cents]) => row(label, cents))}
            <div className="sumrow tot">
                <span>{tradePage.total}</span>
                <span className="mono">{tradePage.inCad(money(total))}</span>
            </div>
            {bill.deposit ? (
                <>
                    {row(tradePage.depositPaid, bill.deposit, "", "−")}
                    {row(tradePage.paidToday, total - bill.deposit, " tot")}
                </>
            ) : null}
            {bill.retainerPct ? (
                <>
                    {row(
                        tradePage.retainerPaid(Math.round(bill.retainerPct * 100)),
                        retainer,
                        "",
                        "−",
                    )}
                    {row(tradePage.balanceDue, total - retainer, " tot")}
                </>
            ) : null}
        </div>
    );
}
