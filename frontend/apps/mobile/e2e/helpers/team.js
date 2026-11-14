// The team as the owner and another device would change it: ACTION "join" makes a verified identity that accepts an invite (with SURNAME), "remove" takes STAFF_ID or the joined member off the team, "forget" also deletes the joined identity, "revoke" drops the open invites whose address starts with PREFIX.
if (
    typeof API_URL === "undefined" ||
    typeof AUTH_URL === "undefined" ||
    typeof E2E_NAMESPACE === "undefined"
)
    throw new Error(
        "API_URL, AUTH_URL or E2E_NAMESPACE is not set: run the flows through the native lane",
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
function headers(token) {
    return {
        "Content-Type": "application/json",
        "X-Session-Token": token,
        "X-Business-Id": "bz_birchbark_" + E2E_NAMESPACE,
    };
}
function call(token, path, body) {
    return http.post(API_URL + path, { headers: headers(token), body: JSON.stringify(body) });
}
function adminUrl() {
    if (typeof AUTH_ADMIN_URL === "undefined")
        throw new Error("AUTH_ADMIN_URL is not set: run the flows through the native lane");
    return AUTH_ADMIN_URL;
}
var owner = session("hannah+" + E2E_NAMESPACE + "@birchbark.example", "demo1234");
if (ACTION === "join") {
    var email = "member-" + String(Date.now()) + "+" + E2E_NAMESPACE + "@example.com";
    var password = "Willow-Meadow-" + Math.random().toString(36).slice(2, 8);
    var name = "Rowan " + SURNAME;
    var created = http.post(adminUrl() + "/admin/identities", {
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
    // a flow that failed before joining has no one to take off, and Maestro passes that as "undefined"
    var given = typeof STAFF_ID !== "undefined" && STAFF_ID && STAFF_ID !== "undefined";
    var id = given ? STAFF_ID : output.member ? output.member.id : null;
    if (id !== null) {
        var removed = call(owner, "/v1/staff/" + id + "/remove", { future: "cancel" });
        if (ACTION === "remove" && removed.status !== 200)
            throw new Error("remove failed: " + removed.status + " " + removed.body);
    }
    if (ACTION === "forget" && output.member)
        http.delete(adminUrl() + "/admin/identities/" + output.member.identity);
} else if (ACTION === "revoke") {
    var team = json(http.get(API_URL + "/v1/staff/team", { headers: headers(owner) }).body);
    team.invites.forEach(function (invite) {
        if (invite.email.indexOf(PREFIX) !== 0) return;
        var revoked = call(owner, "/v1/staff/invites/" + invite.id + "/revoke", {});
        if (revoked.status >= 300)
            throw new Error("revoke failed: " + revoked.status + " " + revoked.body);
    });
} else {
    throw new Error("unknown ACTION " + ACTION);
}
