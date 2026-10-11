import { BUSINESS_CURRENCY, formatCredit, formatMoney } from "@clientbridge/app-core/public";

import type { Brand } from "../content/brands";
import { tradePage } from "../content/solutions";
import type { Bill } from "../content/trades";

// Each tax is rounded half-up on its base, like the app's tax engine.
const taxOn = (base: number, rate: number): number => Math.round(base * rate + 1e-9);

export function BillMock({ bill, brand }: { bill: Bill; brand: Brand }) {
    const subtotal = bill.lines.reduce((sum, [, cents]) => sum + cents, 0);
    const taxes = bill.taxes.map(
        ([label, rate, taxableBase]) => [label, taxOn(taxableBase ?? subtotal, rate)] as const,
    );
    const total = subtotal + taxes.reduce((sum, [, cents]) => sum + cents, 0);
    const retainer = bill.retainerPct ? Math.round(total * bill.retainerPct) : 0;
    const row = (label: string, cents: number, cls = "", credit = false) => (
        <div key={label} className={`sumrow${cls}`}>
            <span>{label}</span>
            <span className="mono">
                {credit
                    ? formatCredit(cents, BUSINESS_CURRENCY)
                    : formatMoney(cents, BUSINESS_CURRENCY)}
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
                <span className="mono">
                    {tradePage.inCad(formatMoney(total, BUSINESS_CURRENCY))}
                </span>
            </div>
            {bill.deposit ? (
                <>
                    {row(tradePage.depositPaid, bill.deposit, "", true)}
                    {row(tradePage.paidToday, total - bill.deposit, " tot")}
                </>
            ) : null}
            {bill.retainerPct ? (
                <>
                    {row(tradePage.retainerPaid(bill.retainerPct), retainer, "", true)}
                    {row(tradePage.balanceDue, total - retainer, " tot")}
                </>
            ) : null}
        </div>
    );
}
