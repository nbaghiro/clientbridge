import { Lockup } from "@clientbridge/ui/logo";

import { footer, nav } from "../content/site";

export function Footer() {
    return (
        <footer className="footer">
            <div className="wrap">
                <div className="footer-grid">
                    <div className="stack-12">
                        <a className="brand" href="/" aria-label={nav.home}>
                            <Lockup markClassName="text-logo" />
                        </a>
                        <p className="max-w-[300px]">{footer.blurb}</p>
                    </div>
                    {footer.columns.map((col) => (
                        <div key={col.title} className="footer-cols">
                            <h2 className="footer-h">{col.title}</h2>
                            <ul>
                                {col.links.map((l) => (
                                    <li key={l.label}>
                                        <a href={l.href}>{l.label}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <div className="footer-base">
                    <span>{footer.copyright}</span>
                    <span>{footer.legal}</span>
                </div>
            </div>
        </footer>
    );
}
