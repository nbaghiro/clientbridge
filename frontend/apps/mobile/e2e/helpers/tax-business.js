// A new tax-registered business, in Ontario unless PROVINCE names another, with one client and three services, so the flow can move its province freely.
if (
    typeof AUTH_ADMIN_URL === "undefined" ||
    typeof AUTH_URL === "undefined" ||
    typeof API_URL === "undefined" ||
    typeof E2E_NAMESPACE === "undefined"
)
    throw new Error(
        "the auth, API or namespace URL is not set: run the flows through the native lane",
    );
var stamp = String(Date.now());
var email = "tax-" + stamp + "+" + E2E_NAMESPACE + "@example.com";
var password = "Juniper-Harbour-" + Math.random().toString(36).slice(2, 8);
http.post(AUTH_ADMIN_URL + "/admin/identities", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        schema_id: "default",
        traits: { email: email, name: "Tax Check" },
        credentials: { password: { config: { password: password } } },
        verifiable_addresses: [{ value: email, via: "email", verified: true, status: "completed" }],
    }),
});
var flow = json(http.get(AUTH_URL + "/self-service/login/api").body);
var token = json(
    http.post(AUTH_URL + "/self-service/login?flow=" + flow.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "password", identifier: email, password: password }),
    }).body,
).session_token;
function call(method, path, body, business) {
    var headers = { "Content-Type": "application/json", "X-Session-Token": token };
    if (business) headers["X-Business-Id"] = business;
    var sent = http.request(API_URL + path, {
        method: method,
        headers: headers,
        body: JSON.stringify(body),
    });
    if (sent.status >= 300)
        throw new Error(method + " " + path + " failed: " + sent.status + " " + sent.body);
    return json(sent.body);
}
var business = call("POST", "/v1/onboarding", {
    name: "Tax Check Studio",
    slug: "tax-" + stamp + "-" + E2E_NAMESPACE,
    province: typeof PROVINCE === "undefined" ? "ON" : PROVINCE,
    subject: null,
}).id;
call(
    "PATCH",
    "/v1/business",
    { tax_registered: true, gst_hst_number: "123456789RT0001" },
    business,
);
var client = call("POST", "/v1/clients", { name: "Rowan Tax Check" }, business);
// a standard, a federal-only and an exempt service, so each invoice line brings its own tax class
[
    ["Standard service", 10000, "standard"],
    ["Federal only service", 3333, "federal_only"],
    ["Exempt fee", 4000, "exempt"],
].forEach(function (item) {
    call(
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: item[0],
            duration_min: 30,
            price_cents: item[1],
            tax_class: item[2],
            deposit_type: "none",
            online_bookable: false,
        },
        business,
    );
});
output.tax = {
    email: email,
    password: password,
    token: token,
    business: business,
    client: client.id,
};
