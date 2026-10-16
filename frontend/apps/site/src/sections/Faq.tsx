export function Faq({
    title,
    items,
}: {
    title: string;
    items: readonly { q: string; a: string }[];
}) {
    return (
        <section className="band">
            <div className="wrap narrow">
                <h2 className="h2">{title}</h2>
                <div className="faq">
                    {items.map((item) => (
                        <details key={item.q}>
                            <summary>{item.q}</summary>
                            <p>{item.a}</p>
                        </details>
                    ))}
                </div>
            </div>
        </section>
    );
}
