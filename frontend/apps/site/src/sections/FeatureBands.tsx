import { ContourField } from "../art/Art";
import { TradeGlyph } from "../art/TradeGlyph";
import { Icon } from "../art/Icon";
import { type Feature, type FeatureMock, features } from "../content/home";
import { BookingPageMock } from "../mocks/BookingPageMock";
import { CalendarMock } from "../mocks/CalendarMock";
import { InvoicesMock } from "../mocks/InvoicesMock";
import { ShopPhone } from "../mocks/ShopPhone";
import { StockListMock } from "../mocks/StockListMock";
import { TapToPayPhone } from "../mocks/TapToPayPhone";

function Mock({ kind }: { kind: FeatureMock }) {
    switch (kind) {
        case "calendar":
            return (
                <div className="mock-host">
                    <ContourField name="small" className="art-topo topo-small" />
                    <CalendarMock />
                </div>
            );
        case "invoices":
            return <InvoicesMock />;
        case "tapToPay":
            return (
                <div className="phone-wrap mock-host">
                    <ContourField name="small" className="art-topo topo-small" />
                    <TapToPayPhone />
                </div>
            );
        case "products":
            return (
                <div className="product-pair mock-host">
                    <ContourField name="small" className="art-topo topo-small" />
                    <StockListMock />
                    <ShopPhone />
                </div>
            );
        case "bookingPage":
            return (
                <div className="w-full max-w-[380px] justify-self-center">
                    <BookingPageMock />
                </div>
            );
    }
}

function FeatureBand({ feature, flip }: { feature: Feature; flip: boolean }) {
    return (
        <div className={`feat split${flip ? " flip" : ""}`} id={feature.id}>
            <div className="feat-text">
                <div className="marker">
                    <TradeGlyph name={feature.glyph} />
                    <span className="eyebrow">{feature.eyebrow}</span>
                </div>
                <h2 className="h2">{feature.title}</h2>
                <p className="body">{feature.body}</p>
                {feature.points.length > 0 ? (
                    <ul className="list">
                        {feature.points.map((p) => (
                            <li key={p}>
                                <Icon name="check" className="tick" />
                                {p}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
            <Mock kind={feature.mock} />
        </div>
    );
}

export function FeatureBands() {
    return (
        <section className="band pt-16" id="features">
            <div className="wrap">
                {features.map((f, i) => (
                    <FeatureBand key={f.eyebrow} feature={f} flip={i % 2 === 1} />
                ))}
            </div>
        </section>
    );
}
