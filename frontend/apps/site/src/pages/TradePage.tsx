import { ArcDivider, ContourField } from "../art/Art";
import { TradeGlyph } from "../art/TradeGlyph";
import { links } from "../config";
import { Icon } from "../components/Icon";
import { Photo } from "../components/Photo";
import { BRANDS } from "../content/brands";
import { testimonialPlaceholder } from "../content/home";
import { tradePage } from "../content/solutions";
import { solutionPath, type Trade, TRADES } from "../content/trades";
import { money } from "../format";
import { BillMock } from "../mocks/BillMock";
import { BookingPageMock } from "../mocks/BookingPageMock";
import { ClientRecordMock } from "../mocks/ClientRecordMock";
import { ScheduleMock } from "../mocks/ScheduleMock";
import { CapabilityGrid } from "../sections/CapabilityGrid";
import { Closing } from "../sections/Closing";
import { Testimonial } from "../sections/Proof";

/** One trade's page: how the same app runs that kind of business, with an example business. */
export function TradePage({ trade }: { trade: Trade }) {
    const brand = BRANDS[trade.slug];
    const others = TRADES.filter((o) => o.slug !== trade.slug);
    const booking = {
        tag: `${trade.booking.tag} · ${brand.city}`,
        items: trade.booking.items.map((i) => ({
            name: i.name,
            detail: i.detail,
            price: money(i.cents),
        })),
        date: trade.booking.date,
        times: trade.booking.times,
        selectedTime: 1,
        cta: trade.booking.button,
    };
    const card = trade.heroCard;
    return (
        <>
            <section className="vhero">
                <div className="art-layer">
                    <ContourField name="hero" />
                </div>
                <div className="wrap vhero-grid">
                    <div className="vhero-text">
                        <a className="crumb" href="/solutions">
                            {tradePage.crumb}
                        </a>
                        <div className="vmark">
                            <TradeGlyph name={trade.glyph} />
                            <span className="eyebrow accent">{trade.name}</span>
                        </div>
                        <h1 className="h1">{trade.h1}</h1>
                        <p className="lede">{trade.lede}</p>
                        <div className="cta-row">
                            <a className="btn btn-primary btn-lg" href={links.startFree}>
                                {tradePage.primary}
                            </a>
                            <a className="btn btn-ghost btn-lg" href={links.demoBusiness}>
                                {tradePage.secondary}
                            </a>
                        </div>
                        <p className="note">{tradePage.note}</p>
                    </div>
                    <div className="vhero-media">
                        <figure className="photo">
                            <Photo
                                name={trade.photo.name}
                                alt={trade.photo.alt}
                                position={trade.photo.position}
                                sizes="(max-width: 960px) 100vw, 620px"
                                priority
                            />
                        </figure>
                        <div className="mock card float-card" aria-hidden="true">
                            <div className="xs muted">{card.label}</div>
                            <div className="mt-0.5 text-sm font-semibold">{card.title}</div>
                            <div className="xs soft mt-0.5">{card.detail}</div>
                            <span className={`pill pill-${card.pill.tone} mt-2`}>
                                {card.pill.text}
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            <section className="band" id="bookings">
                <div className="wrap split">
                    <div className="feat-text">
                        <p className="eyebrow">{tradePage.bookingsEyebrow}</p>
                        <h2 className="h2">{trade.bookings.title}</h2>
                        <p className="body">{trade.bookings.body}</p>
                        <ul className="list">
                            {trade.bookings.list.map((item) => (
                                <li key={item}>
                                    <Icon name="check" className="tick" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="mock-stack">
                        <ScheduleMock schedule={trade.schedule} business={brand.name} />
                        <p className="xs muted cap">{tradePage.example}</p>
                    </div>
                </div>
            </section>

            <ArcDivider seed={11} />

            <section className="band pt-14">
                <div className="wrap">
                    <div className="narrow">
                        <div className="vmark small">
                            <TradeGlyph name={trade.glyph} />
                            <span className="eyebrow">{tradePage.dayToDay}</span>
                        </div>
                        <h2 className="h2 mt-3">{tradePage.handles(trade.who)}</h2>
                    </div>
                    <CapabilityGrid items={trade.capabilities} />
                </div>
            </section>

            <section className="band band-bg band-art">
                <div className="art-layer">
                    <ContourField name="band" className="art-topo band-topo" />
                </div>
                <div className="wrap split">
                    <div className="mock-stack w-full max-w-[400px] justify-self-center">
                        {trade.bill ? (
                            <BillMock bill={trade.bill} brand={brand} />
                        ) : trade.record ? (
                            <ClientRecordMock record={trade.record} brand={brand} />
                        ) : null}
                        <p className="xs muted cap">{tradePage.example}</p>
                    </div>
                    <div className="feat-text">
                        <p className="eyebrow">
                            {trade.bill ? tradePage.gettingPaid : tradePage.clientsEyebrow}
                        </p>
                        <h2 className="h2">{trade.pay.title}</h2>
                        <p className="body">{trade.pay.body}</p>
                        <p className="eyebrow mt-8">{tradePage.bookingPage}</p>
                        <div className="book-inline">
                            <BookingPageMock brand={brand} page={booking} />
                        </div>
                    </div>
                </div>
            </section>

            {trade.photo2 ? (
                <section className="band pb-0">
                    <div className="wrap">
                        <figure className="photo wide">
                            <Photo
                                name={trade.photo2.name}
                                alt={trade.photo2.alt}
                                position={trade.photo2.position}
                                sizes="(max-width: 1200px) 100vw, 1120px"
                            />
                        </figure>
                    </div>
                </section>
            ) : null}

            <section className="band">
                <div className="wrap grid-2 items-start">
                    <div className="stack-16">
                        <p className="eyebrow">{tradePage.proofEyebrow(trade.who)}</p>
                        <Testimonial quote={testimonialPlaceholder(1)} />
                    </div>
                    <div className="stack-16">
                        <p className="eyebrow">{tradePage.others}</p>
                        <div className="other-list">
                            {others.map((o) => (
                                <a key={o.slug} href={solutionPath(o.slug)}>
                                    <TradeGlyph name={o.glyph} />
                                    <span>{o.name}</span>
                                    <Icon name="arrow" />
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <Closing copy={tradePage.closing} />
        </>
    );
}
