// A teammate the owner invited, as another device would: ACTION "join" makes a verified identity that accepts an invite (with SURNAME), "remove" takes it off the team, "forget" also deletes the identity.
if (
    typeof API_URL === "undefined" ||
    typeof AUTH_URL === "undefined" ||
    typeof AUTH_ADMIN_URL === "undefined" ||
    typeof E2E_NAMESPACE === "undefined"
)
    throw new Error(
        "API_URL, AUTH_URL, AUTH_ADMIN_URL or E2E_NAMESPACE is not set: run the flows through the native lane",
    );
function session(identifier, password) {
    var flow = json(http.get(AUTH_URL + "/self-service/login/api").body);
    var signed = http.post(AUTH_URL + "/self-service/login?flow=" + flow.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "password", identifier: identifier, password: password }),
    });
    if (signed.status !== 200) throw new Error("sign-in failed: " + signed.status);
    return json(signed.body).session_token;
}
function call(token, path, body) {
    return http.post(API_URL + path, {
        headers: {
            "Content-Type": "application/json",
            "X-Session-Token": token,
            "X-Business-Id": "bz_birchbark_" + E2E_NAMESPACE,
        },
        body: JSON.stringify(body),
    });
}
var owner = session("hannah+" + E2E_NAMESPACE + "@birchbark.example", "demo1234");
if (ACTION === "join") {
    var email = "member-" + String(Date.now()) + "+" + E2E_NAMESPACE + "@example.com";
    var password = "Willow-Meadow-" + Math.random().toString(36).slice(2, 8);
    var name = "Rowan " + SURNAME;
    var created = http.post(AUTH_ADMIN_URL + "/admin/identities", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            schema_id: "default",
            traits: { email: email, name: name },
            credentials: { password: { config: { password: password } } },
            verifiable_addresses: [
                { value: email, via: "email", verified: true, status: "completed" },
            ],
        }),
    });
    if (created.status !== 201) throw new Error("identity failed: " + created.status);
    var invite = call(owner, "/v1/staff/invites", { email: email, role: "staff" });
    if (invite.status !== 201)
        throw new Error("invite failed: " + invite.status + " " + invite.body);
    var joined = call(session(email, password), "/v1/staff/invites/accept", {
        token: json(invite.body).invite_token,
    });
    if (joined.status !== 200)
        throw new Error("accept failed: " + joined.status + " " + joined.body);
    output.member = {
        email: email,
        password: password,
        name: name,
        id: json(joined.body).staff_id,
        identity: json(created.body).id,
    };
} else if (ACTION === "remove" || ACTION === "forget") {
    // a flow that failed before joining has no one to take off
    if (output.member) {
        var removed = call(owner, "/v1/staff/" + output.member.id + "/remove", {
            future: "cancel",
        });
        if (ACTION === "remove" && removed.status !== 200)
            throw new Error("remove failed: " + removed.status + " " + removed.body);
        if (ACTION === "forget")
            http.delete(AUTH_ADMIN_URL + "/admin/identities/" + output.member.identity);
    }
} else {
    throw new Error("unknown ACTION " + ACTION);
}
