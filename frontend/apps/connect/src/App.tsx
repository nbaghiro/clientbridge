import { useLayoutEffect } from "react";
import { strings } from "@clientbridge/app-core/public";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import { PublicStatus } from "./components/PublicStatus";
import { config } from "./config";
import { useEmbedResize } from "./embed";
import { PublicBooking } from "./pages/PublicBooking";
import { PublicContract } from "./pages/PublicContract";
import { PublicEstimate } from "./pages/PublicEstimate";
import { PublicForm } from "./pages/PublicForm";
import { PublicLanding } from "./pages/PublicLanding";
import { PublicManage } from "./pages/PublicManage";
import { PublicPay } from "./pages/PublicPay";
import { PublicPreferences } from "./pages/PublicPreferences";
import { PublicReceipt } from "./pages/PublicReceipt";
import { PublicOrder } from "./pages/PublicOrder";
import { PublicPaymentSetup } from "./pages/PublicPaymentSetup";
import { PublicShop } from "./pages/PublicShop";

// Connect: the public customer pages, where the URL token or slug is the only credential.
export function App() {
    useEmbedResize();
    return (
        <BrowserRouter>
            <PageScroll />
            <SiteRoutes />
        </BrowserRouter>
    );
}

// Each host serves only its own pages, so one link has one address.
function SiteRoutes() {
    switch (config.site?.kind) {
        case "page":
            return (
                <Routes>
                    <Route index element={<PublicLanding />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            );
        case "book":
            return (
                <Routes>
                    <Route path="/m/:token" element={<PublicManage />} />
                    <Route path="/form/:token" element={<PublicForm />} />
                    <Route path="/contract/:token" element={<PublicContract />} />
                    <Route path="/prefs/:token" element={<PublicPreferences />} />
                    <Route path="/:slug" element={<PublicBooking />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            );
        case "shop":
            return (
                <Routes>
                    <Route path="/order/:token" element={<PublicOrder />} />
                    <Route path="/:slug" element={<PublicShop />} />
                    <Route path="/:slug/checkout" element={<PublicShop />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            );
        case "pay":
            return (
                <Routes>
                    <Route path="/i/:token" element={<PublicPay />} />
                    <Route path="/e/:token" element={<PublicEstimate />} />
                    <Route path="/r/:token" element={<PublicReceipt />} />
                    <Route path="/setup" element={<PublicPaymentSetup />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            );
        case undefined:
            return <NotFound />;
    }
}

function NotFound() {
    return (
        <PublicStatus
            kind="notFound"
            title={strings.publicLanding.pageNotFoundTitle}
            body={strings.publicLanding.pageNotFoundBody}
        />
    );
}

function PageScroll() {
    const { pathname } = useLocation();
    useLayoutEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, [pathname]);
    return null;
}
