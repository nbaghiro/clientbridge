import { Lockup } from "@clientbridge/ui/logo";

import { nav } from "../content/site";

const isCurrent = (href: string, current?: string): boolean =>
    current !== undefined && (current === href || current.startsWith(`${href}/`));

/** Sticky header. The small-screen menu is a <details> disclosure, so it works without JavaScript. */
export function Header({ current }: { current?: string }) {
    return (
        <header className="nav">
            <div className="wrap">
                <a className="brand" href="/" aria-label={nav.home}>
                    <Lockup />
                </a>
                <nav className="nav-links" aria-label={nav.primary}>
                    {nav.links.map((l) => (
                        <a
                            key={l.href}
                            href={l.href}
                            aria-current={isCurrent(l.href, current) ? "page" : undefined}
                        >
                            {l.label}
                        </a>
                    ))}
                </nav>
                <div className="nav-right">
                    <a className="signin" href={nav.signIn.href}>
                        {nav.signIn.label}
                    </a>
                    <a className="btn btn-primary" href={nav.startFree.href}>
                        {nav.startFree.label}
                    </a>
                    <details className="nav-menu">
                        <summary aria-label={nav.menu}>
                            <span aria-hidden="true" />
                        </summary>
                        <div className="nav-sheet">
                            {nav.links.map((l) => (
                                <a key={l.href} href={l.href}>
                                    {l.label}
                                </a>
                            ))}
                            <a href={nav.signIn.href}>{nav.signIn.label}</a>
                        </div>
                    </details>
                </div>
            </div>
        </header>
    );
}
