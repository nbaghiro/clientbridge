import type { GlyphName } from "../art/TradeGlyph";
import { PageHead } from "../components/PageHead";
import type { Feature, FeatureMock } from "../content/home";
import { paymentDisclosure, paymentsPage } from "../content/pages";
import { Closing } from "../sections/Closing";
import { Faq } from "../sections/Faq";
import { FeatureBand } from "../sections/FeatureBands";
import { Fees } from "../sections/Fees";
import { PaymentFlow } from "../sections/PaymentFlow";

const BAND_ART: readonly { glyph: GlyphName; mock: FeatureMock }[] = [
    { glyph: "comb", mock: "tapToPay" },
    { glyph: "book", mock: "invoices" },
];

export function PaymentsPage() {
    const bands: Feature[] = paymentsPage.bands.map((band, i) => ({
        ...band,
        glyph: BAND_ART[i]?.glyph ?? "book",
        mock: BAND_ART[i]?.mock ?? "invoices",
    }));
    return (
        <>
            <PageHead
                eyebrow={paymentsPage.eyebrow}
                title={paymentsPage.title}
                lede={paymentsPage.lede}
                seed={9}
            />
            <PaymentFlow id="flow" />
            <section className="band pt-16">
                <div className="wrap">
                    {bands.map((band, i) => (
                        <FeatureBand key={band.eyebrow} feature={band} flip={i % 2 === 1} />
                    ))}
                </div>
            </section>
            <Fees>
                <div className="stripe-note">
                    <span className="eyebrow">{paymentsPage.stripeEyebrow}</span>
                    {paymentDisclosure.links.map((link) => (
                        <a key={link.href} href={link.href}>
                            {link.label}
                        </a>
                    ))}
                </div>
            </Fees>
            <Faq title={paymentsPage.faqTitle} items={paymentsPage.faq} />
            <Closing copy={paymentsPage.closing} />
        </>
    );
}
