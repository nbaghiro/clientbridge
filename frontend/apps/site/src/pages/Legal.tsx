import type { LegalPage } from "../content/pages";

export function Legal({ page }: { page: LegalPage }) {
    return (
        <section className="band legal">
            <div className="wrap narrow">
                <h1 className="h1">{page.title}</h1>
                <p className="xs muted mt-4">{page.updated}</p>
                <p className="lede mt-6">{page.intro}</p>
                <section className="mt-10">
                    <h2 className="h3">{page.paymentDisclosure.title}</h2>
                    <p className="body mt-3">{page.paymentDisclosure.body}</p>
                    <ul className="mt-3">
                        {page.paymentDisclosure.links.map((link) => (
                            <li key={link.href}>
                                <a className="underline" href={link.href}>
                                    {link.label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
                {page.sections.map((title) => (
                    <section key={title} className="mt-10">
                        <h2 className="h3">{title}</h2>
                        <p className="placeholder mt-3">{page.placeholder}</p>
                    </section>
                ))}
                <p className="body mt-12">{page.contact}</p>
            </div>
        </section>
    );
}
