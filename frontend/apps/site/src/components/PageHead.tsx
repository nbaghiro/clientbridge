import { ArcMark, ContourField } from "../art/Art";

export function PageHead({
    eyebrow,
    title,
    lede,
    seed,
}: {
    eyebrow: string;
    title: string;
    lede: string;
    seed: number;
}) {
    return (
        <section className="shead vhero">
            <div className="art-layer">
                <ContourField name="hero" />
            </div>
            <div className="wrap">
                <ArcMark seed={seed} width={88} />
                <p className="eyebrow accent mt-4">{eyebrow}</p>
                <h1 className="h1">{title}</h1>
                <p className="lede">{lede}</p>
            </div>
        </section>
    );
}
