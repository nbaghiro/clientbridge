interface Links {
    slug: string;
    invoice: string;
    estimate: string;
    receipt: string;
    order: string;
    manage: string;
    form: string;
    contract: string;
}

// `make test-connect` mints these with backend/scripts/connect_links.py.
const parsed = JSON.parse(process.env.CONNECT_LINKS ?? "null") as Links | null;
if (parsed === null) throw new Error("run through `make test-connect`, which sets CONNECT_LINKS");
export const links: Links = parsed;
