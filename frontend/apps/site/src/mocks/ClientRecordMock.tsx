import type { Brand } from "../content/brands";
import { tradePage } from "../content/solutions";
import type { ClientRecord } from "../content/trades";

const initials = (name: string): string =>
    name
        .split(" ")
        .map((w) => w.charAt(0))
        .join("");

/** A client's record in the web app: students, plan, upcoming visits and signed forms. */
export function ClientRecordMock({ record, brand }: { record: ClientRecord; brand: Brand }) {
    const { plan } = record;
    return (
        <div className="mock card record" aria-hidden="true">
            <div className="rec-biz">
                <img className="biz-ava sm" src={brand.avatar} alt="" width={22} height={22} />
                <span>{brand.name}</span>
                <span className="muted">· {tradePage.clients}</span>
            </div>
            <div className="rec-head">
                <div className="av">{initials(record.name)}</div>
                <div>
                    <div className="font-semibold">{record.name}</div>
                    <div className="xs muted">{record.detail}</div>
                </div>
            </div>
            {record.students.length > 0 ? (
                <div className="rec-sec">
                    <div className="rec-label">{tradePage.students}</div>
                    <div className="pill-row">
                        {record.students.map((s) => (
                            <span key={s} className="pill pill-accent">
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}
            <div className="rec-sec">
                <div className="rec-label">{tradePage.plan}</div>
                <div className="flex justify-between text-[13px]">
                    <span>{plan.name}</span>
                    <span className="mono">{tradePage.used(plan.used, plan.total)}</span>
                </div>
                <div className="bar">
                    <i
                        style={{ width: `${String(Math.round((plan.used / plan.total) * 100))}%` }}
                    />
                </div>
            </div>
            <div className="rec-sec">
                <div className="rec-label">{tradePage.upcoming}</div>
                {record.upcoming.map((u) => (
                    <div key={`${u.when}-${u.what}`} className="lp-row py-2">
                        <div>
                            <div>{u.what}</div>
                            <div className="who">
                                {u.when} · {u.with}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="rec-sec">
                <div className="rec-label">{tradePage.forms}</div>
                <div className="pill-row">
                    {record.forms.map((f) => (
                        <span key={f} className="pill pill-ok">
                            {tradePage.signed(f)}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
