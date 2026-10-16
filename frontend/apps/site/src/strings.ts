// Generated from locales/en-CA.json by `make gen-strings`; edit the catalog, not this file.
import english from "../locales/en-CA.json" with { type: "json" };
import { catalog } from "@clientbridge/app-core/public";

type Labels = Readonly<Record<string, string>>;

interface Strings {
    readonly site: {
        readonly nav: {
            readonly skip: string;
            readonly home: string;
            readonly menu: string;
            readonly primary: string;
            readonly links: readonly [
                { readonly label: string } & Labels,
                { readonly label: string } & Labels,
                { readonly label: string } & Labels,
                { readonly label: string } & Labels,
            ];
            readonly signIn: { readonly label: string } & Labels;
            readonly startFree: { readonly label: string } & Labels;
        };
        readonly footer: {
            readonly blurb: string;
            readonly columns: readonly [
                {
                    readonly title: string;
                    readonly links: readonly [
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                    ];
                },
                {
                    readonly title: string;
                    readonly links: { readonly "1": { readonly label: string } & Labels };
                },
                {
                    readonly title: string;
                    readonly links: readonly [
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                        { readonly label: string } & Labels,
                    ];
                },
            ];
            readonly copyright: (year: string) => string;
        };
        readonly notFound: {
            readonly title: string;
            readonly body: string;
            readonly back: string;
        } & Labels;
        readonly waitlist: {
            readonly cta: string;
            readonly note: string;
            readonly closing: { readonly title: string; readonly lede: string } & Labels;
            readonly trialAnswer: string;
            readonly meta: { readonly headline: string; readonly description: string } & Labels;
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly email: string;
            readonly honeypot: string;
            readonly submit: string;
            readonly consent: string;
            readonly retry: (email: string) => string;
            readonly thanks: {
                readonly meta: { readonly headline: string; readonly description: string } & Labels;
                readonly title: string;
                readonly body: string;
                readonly features: string;
                readonly pricing: string;
            };
        };
        readonly pageTitle: (page: string) => string;
        readonly jsonLd: { readonly description: string } & Labels;
    };
    readonly home: {
        readonly homeMeta: {
            readonly title: string;
            readonly description: string;
            readonly headline: string;
        } & Labels;
        readonly hero: {
            readonly eyebrow: string;
            readonly title: readonly [string, string];
            readonly lede: string;
            readonly primary: string;
            readonly secondary: string;
            readonly note: string;
        };
        readonly props: readonly [
            { readonly title: string; readonly body: string } & Labels,
            { readonly title: string; readonly body: string } & Labels,
            { readonly title: string; readonly body: string } & Labels,
        ];
        readonly solutionsIntro: {
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
        } & Labels;
        readonly features: readonly [
            {
                readonly eyebrow: string;
                readonly title: string;
                readonly body: string;
                readonly points: readonly [string, string, string];
            },
            {
                readonly eyebrow: string;
                readonly title: string;
                readonly body: string;
                readonly points: readonly [string, string, string];
            },
            {
                readonly eyebrow: string;
                readonly title: string;
                readonly body: string;
                readonly points: readonly [string, string, string];
            },
            {
                readonly eyebrow: string;
                readonly title: string;
                readonly body: string;
                readonly points: readonly [string, string, string];
            },
            { readonly eyebrow: string; readonly title: string; readonly body: string } & Labels,
        ];
        readonly payments: {
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly steps: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly link: string;
        };
        readonly included: {
            readonly eyebrow: string;
            readonly title: string;
            readonly items: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
        };
        readonly pricing: {
            readonly eyebrow: string;
            readonly title: string;
            readonly body: string;
            readonly price: (price: string) => string;
            readonly per: string;
            readonly note: (price: string) => string;
            readonly points: readonly [string, string, string, (price: string) => string];
            readonly cta: string;
        };
        readonly closing: {
            readonly title: string;
            readonly lede: string;
            readonly primary: string;
            readonly secondary: string;
        } & Labels;
    };
    readonly pages: {
        readonly pricingMeta: { readonly headline: string; readonly description: string } & Labels;
        readonly pricingPage: {
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly plans: {
                readonly premium: {
                    readonly name: string;
                    readonly summary: string;
                    readonly staff: (price: string) => string;
                };
                readonly team: {
                    readonly name: string;
                    readonly summary: string;
                    readonly staff: string;
                } & Labels;
                readonly price: (price: string) => string;
                readonly per: string;
                readonly yearly: (price: string) => string;
                readonly trial: string;
                readonly cta: string;
            };
            readonly included: {
                readonly title: string;
                readonly groups: readonly [
                    {
                        readonly title: string;
                        readonly items: readonly [string, string, string, string];
                    },
                    {
                        readonly title: string;
                        readonly items: readonly [string, string, string, string, string];
                    },
                    {
                        readonly title: string;
                        readonly items: readonly [string, string, string, string];
                    },
                ];
            };
            readonly fees: {
                readonly title: string;
                readonly lede: string;
                readonly rows: readonly [
                    { readonly label: string; readonly value: string } & Labels,
                    { readonly label: string; readonly value: string } & Labels,
                    { readonly label: string; readonly value: string } & Labels,
                    { readonly label: string; readonly value: string } & Labels,
                    { readonly label: string; readonly value: string } & Labels,
                ];
            };
            readonly faqTitle: string;
            readonly faq: readonly [
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
                { readonly q: string; readonly a: string } & Labels,
            ];
            readonly closing: {
                readonly title: string;
                readonly lede: string;
                readonly primary: string;
                readonly secondary: string;
            } & Labels;
        };
        readonly featuresMeta: { readonly headline: string; readonly description: string } & Labels;
        readonly featuresPage: {
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly groups: {
                readonly bookings: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly clients: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly invoices: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly payments: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly products: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                    ];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly tax: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly staff: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly messaging: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
                readonly apps: {
                    readonly title: string;
                    readonly body: string;
                    readonly items: readonly [string, string, string, string];
                    readonly link: { readonly label: string } & Labels;
                };
            };
            readonly tradesTitle: string;
        };
        readonly legal: {
            readonly updated: (date: string) => string;
            readonly contactTitle: string;
            readonly address: string;
        };
        readonly paymentDisclosure: {
            readonly title: string;
            readonly body: string;
            readonly links: readonly [
                { readonly label: string } & Labels,
                { readonly label: string } & Labels,
                { readonly label: string } & Labels,
            ];
        };
        readonly privacyPage: {
            readonly meta: { readonly headline: string; readonly description: string } & Labels;
            readonly title: string;
            readonly intro: string;
            readonly sections: readonly [
                { readonly title: string; readonly body: readonly [string, string, string] },
                {
                    readonly title: string;
                    readonly body: readonly [string];
                    readonly items: readonly [
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                    ];
                },
                {
                    readonly title: string;
                    readonly body: readonly [string];
                    readonly items: readonly [
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                    ];
                },
                { readonly title: string; readonly body: readonly [string, string, string] },
                {
                    readonly title: string;
                    readonly body: readonly [string];
                    readonly items: readonly [
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                        string,
                    ];
                },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string, string, string] },
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
            ];
            readonly contact: (email: string, address: string) => string;
        };
        readonly termsPage: {
            readonly meta: { readonly headline: string; readonly description: string } & Labels;
            readonly title: string;
            readonly intro: string;
            readonly sections: readonly [
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string] },
                {
                    readonly title: string;
                    readonly body: readonly [string, string, string, string];
                },
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string, string] },
                {
                    readonly title: string;
                    readonly body: readonly [string];
                    readonly items: readonly [string, string, string, string, string, string];
                },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string, string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string, string] },
                {
                    readonly title: string;
                    readonly body: readonly [string, string, string, string];
                },
                { readonly title: string; readonly body: readonly [string] },
                { readonly title: string; readonly body: readonly [string] },
            ];
            readonly contact: (email: string, address: string) => string;
        };
        readonly paymentsPage: {
            readonly meta: { readonly headline: string; readonly description: string } & Labels;
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly bands: readonly [
                {
                    readonly eyebrow: string;
                    readonly title: string;
                    readonly body: string;
                    readonly points: readonly [string, string, string];
                },
                {
                    readonly eyebrow: string;
                    readonly title: string;
                    readonly body: string;
                    readonly points: readonly [string, string, string];
                },
            ];
            readonly stripeEyebrow: string;
            readonly faqTitle: string;
            readonly closing: {
                readonly title: string;
                readonly lede: string;
                readonly primary: string;
                readonly secondary: string;
            } & Labels;
        };
        readonly contactPage: {
            readonly meta: { readonly headline: string; readonly description: string } & Labels;
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly name: string;
            readonly email: string;
            readonly message: string;
            readonly honeypot: string;
            readonly submit: string;
            readonly consent: string;
            readonly retry: string;
            readonly reach: (email: string, address: string) => string;
            readonly thanks: {
                readonly meta: { readonly headline: string; readonly description: string } & Labels;
                readonly title: string;
                readonly body: string;
                readonly features: string;
                readonly pricing: string;
            };
        };
    };
    readonly solutions: {
        readonly solutionsMeta: { readonly title: string; readonly description: string } & Labels;
        readonly solutionsPage: {
            readonly eyebrow: string;
            readonly title: string;
            readonly lede: string;
            readonly engineEyebrow: string;
            readonly engineTitle: string;
            readonly engine: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly closing: {
                readonly title: string;
                readonly lede: string;
                readonly primary: string;
                readonly secondary: string;
            } & Labels;
            readonly cardLink: (who: string) => string;
        };
        readonly tradePage: {
            readonly crumb: string;
            readonly primary: string;
            readonly secondary: string;
            readonly note: string;
            readonly bookingsEyebrow: string;
            readonly example: string;
            readonly dayToDay: string;
            readonly gettingPaid: string;
            readonly clientsEyebrow: string;
            readonly bookingPage: string;
            readonly others: string;
            readonly closing: {
                readonly title: string;
                readonly lede: string;
                readonly primary: string;
                readonly secondary: string;
            } & Labels;
            readonly scheduleTitle: string;
            readonly scheduleViews: readonly [string, string, string];
            readonly subtotal: string;
            readonly total: string;
            readonly depositPaid: string;
            readonly paidToday: string;
            readonly balanceDue: string;
            readonly clients: string;
            readonly students: string;
            readonly plan: string;
            readonly upcoming: string;
            readonly forms: string;
            readonly handles: (who: string) => string;
            readonly bookingTag: (tag: string, city: string) => string;
            readonly inCad: (amount: string) => string;
            readonly retainerPaid: (share: number) => string;
            readonly used: (used: number, total: number) => string;
            readonly signed: (form: string) => string;
        };
        readonly tradeMeta: { readonly title: (trade: string) => string };
    };
    readonly trades: {
        readonly "pet-grooming": {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string], readonly [string], readonly [string]];
                readonly taxes: readonly [readonly [string], readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
        readonly salons: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string], readonly [string], readonly [string]];
                readonly taxes: readonly [readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
        readonly fitness: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string]];
                readonly taxes: readonly [readonly [string], readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
        readonly cleaning: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string], readonly [string]];
                readonly taxes: readonly [readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
        readonly tutoring: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly record: {
                readonly name: string;
                readonly detail: string;
                readonly students: readonly [string, string];
                readonly plan: { readonly name: string } & Labels;
                readonly upcoming: readonly [
                    {
                        readonly when: string;
                        readonly what: string;
                        readonly with: string;
                    } & Labels,
                    {
                        readonly when: string;
                        readonly what: string;
                        readonly with: string;
                    } & Labels,
                    {
                        readonly when: string;
                        readonly what: string;
                        readonly with: string;
                    } & Labels,
                ];
                readonly forms: readonly [string, string];
            };
        };
        readonly wellness: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly record: {
                readonly name: string;
                readonly detail: string;
                readonly plan: { readonly name: string } & Labels;
                readonly upcoming: readonly [
                    {
                        readonly when: string;
                        readonly what: string;
                        readonly with: string;
                    } & Labels,
                    {
                        readonly when: string;
                        readonly what: string;
                        readonly with: string;
                    } & Labels,
                ];
                readonly forms: readonly [string, string];
            };
        };
        readonly photography: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string], readonly [string]];
                readonly taxes: readonly [readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
        readonly trades: {
            readonly name: string;
            readonly who: string;
            readonly oneLine: string;
            readonly h1: string;
            readonly lede: string;
            readonly photo: { readonly alt: string } & Labels;
            readonly photo2: { readonly alt: string } & Labels;
            readonly heroCard: {
                readonly label: string;
                readonly title: string;
                readonly detail: string;
                readonly pill: { readonly text: string } & Labels;
            };
            readonly bookings: {
                readonly title: string;
                readonly body: string;
                readonly list: readonly [string, string, string, string];
            };
            readonly schedule: {
                readonly day: string;
                readonly columns: readonly [
                    readonly [string, string],
                    readonly [string, string],
                    readonly [string, string],
                ];
                readonly events: readonly [
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                    { readonly title: string; readonly detail: string } & Labels,
                ];
            };
            readonly booking: {
                readonly tag: string;
                readonly items: readonly [
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                    { readonly name: string; readonly detail: string } & Labels,
                ];
                readonly date: string;
                readonly times: readonly [string, string, string, string];
                readonly button: string;
            };
            readonly capabilities: readonly [
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
                { readonly title: string; readonly body: string } & Labels,
            ];
            readonly pay: { readonly title: string; readonly body: string } & Labels;
            readonly bill: {
                readonly meta: string;
                readonly lines: readonly [readonly [string], readonly [string]];
                readonly taxes: readonly [readonly [string]];
                readonly status: { readonly text: string } & Labels;
            };
        };
    };
    readonly demo: {
        readonly demoBusiness: { readonly name: string; readonly tag: string } & Labels;
        readonly appNav: {
            readonly items: {
                readonly today: string;
                readonly schedule: string;
                readonly clients: string;
                readonly payments: string;
                readonly inbox: string;
            } & Labels;
            readonly setup: string;
        };
        readonly invoiceTable: {
            readonly columns: {
                readonly number: string;
                readonly client: string;
                readonly status: string;
                readonly total: string;
            } & Labels;
            readonly paid: string;
            readonly draft: string;
        };
        readonly phonePayments: {
            readonly time: string;
            readonly title: string;
            readonly count: (invoices: number, estimates: number) => string;
            readonly tabs: readonly [string, string, string, string, string];
            readonly newLabel: string;
            readonly segments: readonly [string, string];
            readonly search: string;
            readonly tabBar: readonly [string, string, string, string];
        };
        readonly stockList: {
            readonly title: string;
            readonly filters: readonly [string, string, string];
            readonly restock: string;
        };
        readonly shop: {
            readonly title: string;
            readonly business: string;
            readonly subtotalLabel: string;
            readonly pickup: string;
            readonly pay: string;
            readonly minus: string;
        } & Labels;
        readonly minutes: (minutes: number) => string;
        readonly stock: {
            readonly inStock: (count: number) => string;
            readonly low: (count: number) => string;
            readonly untracked: string;
            readonly service: string;
        };
        readonly tapToPay: {
            readonly charge: (name: string) => string;
            readonly includes: (taxes: string) => string;
            readonly tax: (name: string, amount: string) => string;
            readonly prompt: string;
            readonly caption: string;
        };
        readonly bookingPage: {
            readonly payDeposit: (amount: string) => string;
            readonly book: string;
        };
        readonly today: {
            readonly title: string;
            readonly subtitle: string;
            readonly sales: string;
            readonly salesCaption: string;
            readonly awaiting: string;
            readonly awaitingCaption: string;
            readonly taxes: string;
            readonly taxesCaption: string;
            readonly activityTitle: string;
            readonly payment: (method: string) => string;
        };
    };
}

export const strings = catalog(
    english,
    async () => (await import("../locales/en-XA.json")).default,
) as Strings;
