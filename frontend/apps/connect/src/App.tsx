import { strings } from "@clientbridge/app-core/public";
import { BrowserRouter, Route, Routes } from "react-router-dom";

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
            <Routes>
                <Route path="/payment-method" element={<PublicPaymentSetup />} />
                <Route path="/b/:slug" element={<PublicLanding />} />
                <Route path="/book/:slug" element={<PublicBooking />} />
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
                <Route path="/shop/:slug" element={<PublicShop />} />
                <Route path="/shop/:slug/checkout" element={<PublicShop />} />
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
