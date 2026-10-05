import { Lockup } from "@clientbridge/ui/logo";

import { Icon, type IconName } from "../art/Icon";
import { appNav, demoBusiness, today } from "../content/demo";

const NAV_ICONS: Record<(typeof appNav.items)[number], IconName> = {
    Today: "today",
    Schedule: "calendar",
    Clients: "clients",
    Payments: "invoice",
    Inbox: "inbox",
};

function SideNav() {
    return (
        <aside className="appwin-side">
            <Lockup className="side-brand" />
            {appNav.items.map((item) => (
                <div key={item} className={`navi${item === "Today" ? " on" : ""}`}>
                    <Icon name={NAV_ICONS[item]} />
                    {item}
                </div>
            ))}
            <div className="spacer" />
            <div className="navi">
                <Icon name="settings" />
                {appNav.setup}
            </div>
        </aside>
    );
}

function TodayMain() {
    return (
        <div className="appwin-main">
            <div className="m-title">{today.title}</div>
            <div className="m-sub">{today.subtitle}</div>
            <div className="stats">
                {today.stats.map((s) => (
                    <div key={s.label} className="stat">
                        <div className="l">{s.label}</div>
                        <div className={`v${s.good ? " ok" : ""}`}>{s.value}</div>
                        <div className="c">{s.caption}</div>
                    </div>
                ))}
            </div>
            <div className="lp">
                <div className="lp-head">{today.activityTitle}</div>
                {today.activity.map((a) => (
                    <div key={`${a.what}-${a.who}`} className="lp-row">
                        <div>
                            <div>{a.what}</div>
                            <div className="who">{a.who}</div>
                        </div>
                        <span className="amt">{a.amount}</span>
                        <span className="t">{a.when}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function AppWindow() {
    return (
        <div className="mock appwin framed">
            <div className="winbar">
                <i />
                <i />
                <i />
                <span>{demoBusiness.name}</span>
            </div>
            <SideNav />
            <TodayMain />
        </div>
    );
}
