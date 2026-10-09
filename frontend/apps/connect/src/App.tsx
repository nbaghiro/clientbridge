import { useLayoutEffect } from "react";
import { strings } from "@clientbridge/app-core/public";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

import { PublicStatus } from "./components/PublicStatus";
import { useEmbedResize } from "./embed";
import { PublicBooking } from "./pages/PublicBooking";
import { PublicContract } from "./pages/PublicContract";
import { PublicEstimate } from "./pages/PublicEstimate";
import { PublicForm } from "./pages/PublicForm";
import { PublicInterac } from "./pages/PublicInterac";
import { PublicLanding } from "./pages/PublicLanding";
import { PublicManage } from "./pages/PublicManage";
import { PublicPay } from "./pages/PublicPay";
import { PublicPreferences } from "./pages/PublicPreferences";
import { PublicReceipt } from "./pages/PublicReceipt";
import { PublicReview } from "./pages/PublicReview";
import { PublicOrder } from "./pages/PublicOrder";
import { PublicPaymentSetup } from "./pages/PublicPaymentSetup";
import { PublicShop } from "./pages/PublicShop";

// Connect: the public customer pages, where the URL token or slug is the only credential.
export function App() {
    useEmbedResize();
    return (
        <BrowserRouter>
            <PageScroll />
            <Routes>
                <Route path="/payment-method" element={<PublicPaymentSetup />} />
                <Route path="/b/:slug/*" element={<BusinessRoutes />} />
                <Route path="/book/:slug" element={<LegacyBusinessRoute section="book" />} />
                <Route path="/m/:token" element={<PublicManage />} />
                <Route path="/i/:token" element={<PublicPay />} />
                <Route path="/i/:token/etransfer" element={<PublicInterac />} />
                <Route path="/e/:token" element={<PublicEstimate />} />
                <Route path="/r/:token" element={<PublicReceipt />} />
                <Route path="/form/:token" element={<PublicForm />} />
                <Route path="/contract/:token" element={<PublicContract />} />
                <Route path="/review/:token" element={<PublicReview />} />
                <Route path="/prefs/:token" element={<PublicPreferences />} />
                <Route path="/order/:token" element={<PublicOrder />} />
                <Route path="/shop/:slug" element={<LegacyBusinessRoute section="shop" />} />
                <Route
                    path="/shop/:slug/checkout"
                    element={<LegacyBusinessRoute section="shop/checkout" />}
                />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    );
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

function BusinessRoutes() {
    const { slug } = useParams();
    return (
        <Routes key={slug}>
            <Route index element={<PublicLanding />} />
            <Route path="book" element={<PublicBooking key="booking" />} />
            <Route path="shop/*" element={<ShopRoutes />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}

function ShopRoutes() {
    const { "*": path } = useParams();
    return path === "" || path === "checkout" ? <PublicShop /> : <NotFound />;
}

function LegacyBusinessRoute({ section }: { section: string }) {
    const { slug = "" } = useParams();
    const location = useLocation();
    return (
        <Navigate
            replace
            to={`/b/${encodeURIComponent(slug)}/${section}${location.search}${location.hash}`}
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
