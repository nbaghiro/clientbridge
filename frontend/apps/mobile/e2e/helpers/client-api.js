// Changes a client as another device would: METHOD on PATH with BODY, signed in as the owner.
if (typeof API_URL === "undefined" || typeof AUTH_URL === "undefined")
    throw new Error("API_URL or AUTH_URL is not set: run the flows through the native lane");
var flow = json(http.get(AUTH_URL + "/self-service/login/api").body);
var session = json(
    http.post(AUTH_URL + "/self-service/login?flow=" + flow.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            method: "password",
            identifier: "hannah+" + E2E_NAMESPACE + "@birchbark.example",
            password: "demo1234",
        }),
    }).body,
);
var sent = http.request(API_URL + PATH, {
    method: METHOD,
    headers: {
        "Content-Type": "application/json",
        "X-Session-Token": session.session_token,
        "X-Business-Id": "bz_birchbark_" + E2E_NAMESPACE,
    },
    body: typeof BODY === "undefined" ? "{}" : BODY,
});
if (sent.status >= 300)
    throw new Error(METHOD + " " + PATH + " failed: " + sent.status + " " + sent.body);
output.response = json(sent.body);
