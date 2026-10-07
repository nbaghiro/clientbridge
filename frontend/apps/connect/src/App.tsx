import { strings } from "@clientbridge/app-core/public";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { PublicStatus } from "./components/PublicStatus";
import { useEmbedResize } from "./embed";
import { PublicBooking } from "./pages/PublicBooking";
import { PublicContract } from "./pages/PublicContract";
import { PublicForm } from "./pages/PublicForm";
import { PublicLanding } from "./pages/PublicLanding";
import { PublicPay } from "./pages/PublicPay";
import { PublicPreferences } from "./pages/PublicPreferences";
import { PublicReview } from "./pages/PublicReview";
import { PublicShop } from "./pages/PublicShop";

// Connect: the public customer pages, where the URL token or slug is the only credential.
export function App() {
    useEmbedResize();
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/b/:slug" element={<PublicLanding />} />
                <Route path="/book/:slug" element={<PublicBooking />} />
                <Route path="/pay/:token" element={<PublicPay />} />
                <Route path="/i/:token" element={<PublicPay />} />
                <Route path="/form/:token" element={<PublicForm />} />
                <Route path="/contract/:token" element={<PublicContract />} />
                <Route path="/review/:token" element={<PublicReview />} />
                <Route path="/prefs/:token" element={<PublicPreferences />} />
                <Route path="/shop/:slug" element={<PublicShop />} />
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
