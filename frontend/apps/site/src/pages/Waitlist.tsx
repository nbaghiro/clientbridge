import { ArcMark } from "../art/Art";
import { PageHead } from "../components/PageHead";
import { contactEmail } from "../content/pages";
import { waitlistPage } from "../content/waitlist";

/** The sign-up form posts to the site's server, which answers with the thanks or retry page. */
export function Waitlist({ retry = false }: { retry?: boolean }) {
    const page = waitlistPage;
    return (
        <>
            <PageHead eyebrow={page.eyebrow} title={page.title} lede={page.lede} seed={7} />
            <section className="pb-20">
                <div className="wrap">
                    <div className="waitlist-body">
                        {retry ? (
                            <p className="waitlist-retry" role="alert">
                                {page.retry(contactEmail)}
                            </p>
                        ) : null}
                        <form className="card waitlist" method="post" action="/waitlist">
                            <label className="waitlist-label" htmlFor="waitlist-email">
                                {page.email}
                            </label>
                            <div className="waitlist-row">
                                <input
                                    className="waitlist-input"
                                    id="waitlist-email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    maxLength={254}
                                    required
                                />
                                <button className="btn btn-primary btn-lg" type="submit">
                                    {page.submit}
                                </button>
                            </div>
                            <div className="waitlist-trap" aria-hidden="true">
                                <label htmlFor="waitlist-website">{page.honeypot}</label>
                                <input
                                    id="waitlist-website"
                                    name="website"
                                    type="text"
                                    tabIndex={-1}
                                    autoComplete="off"
                                />
                            </div>
                            <p className="xs muted">{page.consent}</p>
                        </form>
                    </div>
                </div>
            </section>
        </>
    );
}

export function WaitlistThanks() {
    const { thanks } = waitlistPage;
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
