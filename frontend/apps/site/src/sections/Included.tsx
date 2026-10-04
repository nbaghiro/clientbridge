import { LineIcon } from "../art/LineIcon";
import { included } from "../content/home";

export function Included() {
    return (
        <section className="band">
            <div className="wrap">
                <div className="narrow">
                    <p className="eyebrow">{included.eyebrow}</p>
                    <h2 className="h2 mt-3">{included.title}</h2>
                </div>
                <div className="more">
                    {included.items.map((item) => (
                        <div key={item.title}>
                            <LineIcon name={item.icon} />
                            <h3 className="h3">{item.title}</h3>
                            <p>{item.body}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
