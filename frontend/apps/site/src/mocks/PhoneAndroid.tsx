import { Icon, type IconName } from "../art/Icon";
import { invoices, invoiceTable, phonePayments } from "../content/demo";

const TAB_ICONS: Record<string, IconName> = {
    Today: "today",
    Schedule: "calendar",
    Clients: "clients",
    Payments: "invoice",
};

function StatusIcons() {
    return (
        <span className="si">
            <svg viewBox="0 0 16 12">
                <path d="M8 12L0 2.8A12.5 12.5 0 0 1 16 2.8z" />
            </svg>
            <svg viewBox="0 0 13 13">
                <path d="M13 0v13H0z" />
            </svg>
            <svg viewBox="0 0 8 13">
                <path d="M2 0h4v1.5h1a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1h1z" />
            </svg>
        </span>
    );
}

function TabBar({ active }: { active: string }) {
    const [first, second, ...rest] = phonePayments.tabBar;
    const tab = (label: string | undefined) =>
        label === undefined ? null : (
            <div key={label} className={label === active ? "on" : undefined}>
                <Icon name={TAB_ICONS[label] ?? "today"} />
                {label}
            </div>
        );
    return (
        <div className="mtabs">
            {tab(first)}
            {tab(second)}
            <div>
                <div className="plus">
                    <Icon name="plus" className="" />
                </div>
            </div>
            {rest.map(tab)}
        </div>
    );
}

export function PhoneAndroid() {
    return (
        <div className="mock dev android" aria-hidden="true">
            <div className="dev-frame">
                <div className="dev-scr">
                    <div className="sbar">
                        <span>{phonePayments.time}</span>
                        <i className="punch" />
                        <StatusIcons />
                    </div>
                    <div className="mbody">
                        <div className="mh1 mt-2">{phonePayments.title}</div>
                        <div className="mpay-tabs">
                            {phonePayments.tabs.map((t, i) => (
                                <span key={t} className={i === 0 ? "on" : undefined}>
                                    {t}
                                </span>
                            ))}
                        </div>
                        <div className="mcount">
                            <span>{phonePayments.count}</span>
                            <span className="mnew">{phonePayments.newLabel}</span>
                        </div>
                        <div className="mseg">
                            {phonePayments.segments.map((s, i) => (
                                <span key={s} className={i === 0 ? "on" : undefined}>
                                    {s}
                                </span>
                            ))}
                        </div>
                        <div className="msearch">
                            <Icon name="search" className="h-[18px] w-[18px]" />
                            {phonePayments.search}
                        </div>
                        {invoices.map((row) => (
                            <div key={row.number} className="minv">
                                <div>
                                    <b>#{row.number}</b>
                                    <span className="who">{row.client}</span>
                                </div>
                                <div className="r">
                                    {row.total}
                                    <br />
                                    {row.paid ? (
                                        <span className="pill pill-ok">{invoiceTable.paid}</span>
                                    ) : (
                                        <span className="draft">{invoiceTable.draft}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    <TabBar active="Payments" />
                    <i className="homebar" />
                </div>
            </div>
        </div>
    );
}
