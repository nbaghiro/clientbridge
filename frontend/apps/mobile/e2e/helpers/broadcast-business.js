// ACTION create: a new BC business with no legal address or way to reach it and one client who agreed to offers; ACTION address or contact adds what a broadcast needs.
if (
    typeof AUTH_ADMIN_URL === "undefined" ||
    typeof AUTH_URL === "undefined" ||
    typeof API_URL === "undefined" ||
    typeof E2E_NAMESPACE === "undefined"
)
    throw new Error(
        "the auth, API or namespace URL is not set: run the flows through the native lane",
    );
function call(method, path, body, business) {
    var headers = { "Content-Type": "application/json", "X-Session-Token": output.sender.token };
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
if (ACTION === "create") {
    var stamp = String(Date.now());
    var email = "sender-" + stamp + "+" + E2E_NAMESPACE + "@example.com";
    var password = "Juniper-Harbour-" + Math.random().toString(36).slice(2, 8);
    http.post(AUTH_ADMIN_URL + "/admin/identities", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            schema_id: "default",
            traits: { email: email, name: "Sender Check" },
            credentials: { password: { config: { password: password } } },
            verifiable_addresses: [
                { value: email, via: "email", verified: true, status: "completed" },
            ],
        }),
    });
    var flow = json(http.get(AUTH_URL + "/self-service/login/api").body);
    output.sender = {
        email: email,
        password: password,
        tag: "opening" + String(1000 + Math.floor(Math.random() * 9000)),
        token: json(
            http.post(AUTH_URL + "/self-service/login?flow=" + flow.id, {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method: "password", identifier: email, password: password }),
            }).body,
        ).session_token,
    };
    output.sender.business = call("POST", "/v1/onboarding", {
        name: "Sender Check Studio",
        slug: "sender-" + stamp + "-" + E2E_NAMESPACE,
        province: "BC",
        subject: null,
    }).id;
    call(
        "POST",
        "/v1/clients",
        {
            name: "Wren Okafor",
            phone:
                "250" +
                String(700 + Math.floor(Math.random() * 200)) +
                String(1000 + Math.floor(Math.random() * 8000)),
            marketing_consent: true,
            tags: [output.sender.tag],
        },
        output.sender.business,
    );
} else if (ACTION === "address") {
    call(
        "PATCH",
        "/v1/business",
        {
            street_number: "455",
            street_name: "Granville Street",
            city: "Vancouver",
            postal_code: "V6C 1T1",
        },
        output.sender.business,
    );
} else if (ACTION === "contact") {
    call("PATCH", "/v1/business", { legal_phone: "+16045550120" }, output.sender.business);
} else {
    throw new Error("ACTION is create, address or contact");
}
