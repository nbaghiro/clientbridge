/** A business's public-facing brand, rendered across the customer surfaces (book/pay/form/…).
 *  Values are pre-validated by the server: `primary` is a hex colour, `logo_url` an http(s) URL. */
export interface PublicBrand {
    logo_url: string | null;
    primary: string | null;
    tagline: string | null;
}
