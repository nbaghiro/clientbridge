// Changes the password from another device's session, through the auth service's own settings flow.
if (typeof AUTH_URL === "undefined")
    throw new Error("AUTH_URL is not set: run the flows through the native lane");
var auth = AUTH_URL;
var login = json(http.get(auth + "/self-service/login/api").body);
var session = json(
    http.post(auth + "/self-service/login?flow=" + login.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            method: "password",
            identifier: output.recovery.email,
            password: output.recovery.password,
        }),
    }).body,
);
var token = session.session_token;
var settings = json(
    http.get(auth + "/self-service/settings/api", { headers: { "X-Session-Token": token } }).body,
);
var saved = http.post(auth + "/self-service/settings?flow=" + settings.id, {
    headers: { "Content-Type": "application/json", "X-Session-Token": token },
    body: JSON.stringify({ method: "password", password: output.recovery.newPassword }),
});
if (saved.status !== 200) throw new Error("changing the password failed: " + saved.status);
