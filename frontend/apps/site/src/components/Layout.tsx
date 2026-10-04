import type { ReactNode } from "react";

import { nav } from "../content/site";
import { Footer } from "./Footer";
import { Header } from "./Header";

export function Layout({ children, current }: { children: ReactNode; current?: string }) {
    return (
        <>
            <a className="skip-link" href="#main">
                {nav.skip}
            </a>
            <Header {...(current === undefined ? {} : { current })} />
            <main id="main">{children}</main>
            <Footer />
        </>
    );
}
