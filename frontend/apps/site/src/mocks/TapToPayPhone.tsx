import { Icon, type IconName } from "../art/Icon";
import { tapToPay } from "../content/demo";

const TABS: IconName[] = ["today", "calendar", "clients", "invoice", "inbox"];

/** The mobile Tap to Pay screen in a simple phone frame. */
export function TapToPayPhone() {
    return (
        <div className="mock phone" aria-hidden="true">
            <div className="phone-scr">
                <div className="phone-bar">
                    <i />
                </div>
                <div className="phone-body items-center text-center">
                    <div className="xs muted mt-2">{tapToPay.charge}</div>
                    <div className="mono mt-1 text-[34px] font-semibold">{tapToPay.amount}</div>
                    <div className="xs muted">{tapToPay.tax}</div>
                    <div className="tap-ring">
                        <Icon name="tap" className="h-[52px] w-[52px]" />
                    </div>
                    <div className="text-[15px] font-semibold">{tapToPay.prompt}</div>
                    <div className="xs muted mt-1">{tapToPay.caption}</div>
                </div>
                <div className="tabbar">
                    {TABS.map((t) => (
                        <span key={t} className={t === "invoice" ? "on" : undefined}>
                            <Icon name={t} />
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
