import { Layout } from "./components/Layout";
import type { SiteRoute } from "./routes";

export function App({ route }: { route: SiteRoute }) {
    const { Page } = route;
    return (
        <Layout current={route.path}>
            <Page />
        </Layout>
    );
}
