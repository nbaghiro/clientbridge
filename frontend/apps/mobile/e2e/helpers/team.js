// Tidies what a team flow made, as the owner would: ACTION "revoke" drops the open invites whose address starts with PREFIX, "remove" takes STAFF_ID off the team.
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
var headers = {
    "Content-Type": "application/json",
    "X-Session-Token": session.session_token,
    "X-Business-Id": "bz_birchbark_" + E2E_NAMESPACE,
};
function post(path) {
    var sent = http.post(API_URL + path, { headers: headers, body: "{}" });
    if (sent.status >= 300)
        throw new Error("POST " + path + " failed: " + sent.status + " " + sent.body);
}
if (ACTION === "revoke") {
    var team = json(http.get(API_URL + "/v1/staff/team", { headers: headers }).body);
    team.invites.forEach(function (invite) {
        if (invite.email.indexOf(PREFIX) === 0) post("/v1/staff/invites/" + invite.id + "/revoke");
    });
} else if (ACTION === "remove") {
    // a flow that failed before joining has no one to take off, and Maestro passes that as "undefined"
    if (typeof STAFF_ID !== "undefined" && STAFF_ID && STAFF_ID !== "undefined")
        post("/v1/staff/" + STAFF_ID + "/remove");
} else {
    throw new Error("unknown ACTION " + ACTION);
}
