import { useEffect } from "react";
import { checkAdminAccess, useAdminAccess } from "@clientbridge/app-core/public";
import { LoadFailed } from "@clientbridge/ui";
import { BrowserRouter } from "react-router-dom";
import { config } from "./config";
import { Login } from "./pages/Login";

const checkAccess = () => checkAdminAccess(config.apiUrl);
const subscribe = () => () => undefined;

export function AdminLogin() {
    const access = useAdminAccess(checkAccess, subscribe);
    useEffect(() => {
        if (access === "allowed" || access === "denied") window.location.replace(config.adminUrl);
    }, [access]);
    if (access === "unavailable") {
        return (
            <LoadFailed
                variant="page"
                onRetry={() => {
                    window.location.reload();
                }}
            />
        );
    }
    if (access !== "signedOut") return null;
    return (
        <BrowserRouter>
            <Login
                probe={false}
                onSuccess={() => {
                    window.location.replace(config.adminUrl);
                }}
            />
        </BrowserRouter>
    );
}
