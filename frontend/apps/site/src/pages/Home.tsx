import { ArcDivider } from "../art/Art";
import { Closing } from "../sections/Closing";
import { FeatureBands } from "../sections/FeatureBands";
import { Hero } from "../sections/Hero";
import { Included } from "../sections/Included";
import { PaymentsBand } from "../sections/PaymentsBand";
import { Pricing } from "../sections/Pricing";
import { Proof } from "../sections/Proof";
import { Props } from "../sections/Props";
import { TradeStrip } from "../sections/TradeStrip";

export function Home() {
    return (
        <>
            <Hero />
            <Props />
            <TradeStrip />
            <ArcDivider seed={11} />
            <FeatureBands />
            <PaymentsBand />
            <Included />
            <Proof />
            <Pricing />
            <Closing />
        </>
    );
}
