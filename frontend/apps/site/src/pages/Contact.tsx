import { ArcMark } from "../art/Art";
import { PageHead } from "../components/PageHead";
import { contactPage } from "../content/pages";

/** The form posts to the site's server, which emails the team and answers with thanks or retry. */
export function Contact({ retry = false }: { retry?: boolean }) {
    const page = contactPage;
    return (
        <>
            <PageHead eyebrow={page.eyebrow} title={page.title} lede={page.lede} seed={4} />
            <section className="pb-20">
                <div className="wrap">
                    <div className="waitlist-body">
                        {retry ? (
                            <p className="waitlist-retry" role="alert">
                                {page.retry}
                            </p>
                        ) : null}
                        <form className="card waitlist" method="post" action="/contact">
                            <label className="waitlist-label" htmlFor="contact-name">
                                {page.name}
                            </label>
                            <input
                                className="waitlist-input"
                                id="contact-name"
                                name="name"
                                type="text"
                                autoComplete="name"
                                maxLength={100}
                                required
                            />
                            <label className="waitlist-label mt-2" htmlFor="contact-email">
                                {page.email}
                            </label>
                            <input
                                className="waitlist-input"
                                id="contact-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                maxLength={254}
                                required
                            />
                            <label className="waitlist-label mt-2" htmlFor="contact-message">
                                {page.message}
                            </label>
                            <textarea
                                className="waitlist-input contact-message"
                                id="contact-message"
                                name="message"
                                rows={6}
                                maxLength={5000}
                                required
                            />
                            <div className="waitlist-trap" aria-hidden="true">
                                <label htmlFor="contact-website">{page.honeypot}</label>
                                <input
                                    id="contact-website"
                                    name="website"
                                    type="text"
                                    tabIndex={-1}
                                    autoComplete="off"
                                />
                            </div>
                            <div className="contact-foot">
                                <p className="xs muted">{page.consent}</p>
                                <button className="btn btn-primary btn-lg" type="submit">
                                    {page.submit}
                                </button>
                            </div>
                        </form>
                        <p className="xs muted mt-6">{page.reach}</p>
                    </div>
                </div>
            </section>
        </>
    );
}

export function ContactThanks() {
    const { thanks } = contactPage;
    return (
        <section className="band final">
            <div className="wrap narrow mx-auto">
                <ArcMark seed={3} />
                <h1 className="h2">{thanks.title}</h1>
                <p className="lede mt-4">{thanks.body}</p>
                <div className="cta-row">
                    <a className="btn btn-primary btn-lg" href="/features">
                        {thanks.features}
                    </a>
                    <a className="btn btn-ghost btn-lg" href="/pricing">
                        {thanks.pricing}
                    </a>
                </div>
            </div>
        </section>
    );
}
