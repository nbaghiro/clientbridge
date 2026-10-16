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
                {page.sections.map((section) => (
                    <section key={section.title} className="mt-10">
                        <h2 className="h3">{section.title}</h2>
                        {section.body.map((paragraph) => (
                            <p key={paragraph} className="body mt-3">
                                {paragraph}
                            </p>
                        ))}
                        {section.items.length > 0 ? (
                            <ul className="legal-list mt-3">
                                {section.items.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        ) : null}
                    </section>
                ))}
                <section className="mt-10">
                    <h2 className="h3">{page.contactTitle}</h2>
                    <p className="body mt-3">{page.contact}</p>
                </section>
            </div>
        </section>
    );
}
