import { ArcMark } from "../art/Art";
import { notFound } from "../content/site";

export function NotFound() {
    return (
        <section className="band final">
            <div className="wrap narrow mx-auto">
                <ArcMark seed={3} />
                <h1 className="h2">{notFound.title}</h1>
                <p className="lede mt-4">{notFound.body}</p>
                <div className="cta-row">
                    <a className="btn btn-primary btn-lg" href="/">
                        {notFound.back}
                    </a>
                </div>
            </div>
        </section>
    );
}
