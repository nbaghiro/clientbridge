import { ArcDivider, ArcMark, ContourField } from "../art/Art";
import { solutionsPage } from "../content/solutions";
import { CapabilityGrid } from "../sections/CapabilityGrid";
import { Closing } from "../sections/Closing";
import { SolutionCards } from "../sections/SolutionCards";

export function Solutions() {
    return (
        <>
            <section className="shead vhero">
                <div className="art-layer">
                    <ContourField name="hero" />
                </div>
                <div className="wrap">
                    <ArcMark seed={9} width={88} />
                    <p className="eyebrow accent mt-4">{solutionsPage.eyebrow}</p>
                    <h1 className="h1">{solutionsPage.title}</h1>
                    <p className="lede">{solutionsPage.lede}</p>
                </div>
            </section>
            <section className="pb-24">
                <div className="wrap">
                    <SolutionCards />
                </div>
            </section>
            <ArcDivider seed={11} />
            <section className="band pt-14">
                <div className="wrap">
                    <div className="narrow">
                        <p className="eyebrow">{solutionsPage.engineEyebrow}</p>
                        <h2 className="h2 mt-3">{solutionsPage.engineTitle}</h2>
                    </div>
                    <CapabilityGrid items={solutionsPage.engine} className="engine" />
                </div>
            </section>
            <Closing copy={solutionsPage.closing} />
        </>
    );
}
