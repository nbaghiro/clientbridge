import { strings } from "@clientbridge/app-core/public";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { PublicBooking } from "./pages/PublicBooking";
import { PublicContract } from "./pages/PublicContract";
import { PublicForm } from "./pages/PublicForm";
import { PublicPay } from "./pages/PublicPay";
import { PublicReview } from "./pages/PublicReview";

/** Connect — the unauthenticated customer surfaces. Each route's URL token/slug is the only
 *  credential; there is no session and no PowerSync. */
export function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/book/:slug" element={<PublicBooking />} />
                <Route path="/pay/:token" element={<PublicPay />} />
                <Route path="/form/:token" element={<PublicForm />} />
                <Route path="/contract/:token" element={<PublicContract />} />
                <Route path="/review/:token" element={<PublicReview />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    );
}

function NotFound() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7 text-center shadow-card">
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.connect.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.connect.notFoundBody}</p>
            </div>
        </div>
    );
}
