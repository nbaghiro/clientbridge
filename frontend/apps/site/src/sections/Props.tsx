import { LineIcon } from "../art/LineIcon";
import { props } from "../content/home";

export function Props() {
    return (
        <section className="props">
            <div className="wrap grid-3">
                {props.map((p) => (
                    <div key={p.title} className="prop">
                        <LineIcon name={p.icon} />
                        <h2 className="h3">{p.title}</h2>
                        <p className="body">{p.body}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
