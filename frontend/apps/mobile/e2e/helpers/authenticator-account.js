// Turns an authenticator on for output.recovery from password-account.js, as its owner would on the web.
if (typeof AUTH_URL === "undefined" || typeof CONTROL_URL === "undefined")
    throw new Error("AUTH_URL or CONTROL_URL is not set: run the flows through the native lane");
var login = json(http.get(AUTH_URL + "/self-service/login/api").body);
var token = json(
    http.post(AUTH_URL + "/self-service/login?flow=" + login.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            method: "password",
            identifier: output.recovery.email,
            password: output.recovery.password,
        }),
    }).body,
).session_token;
var settings = json(
    http.get(AUTH_URL + "/self-service/settings/api", {
        headers: { "X-Session-Token": token },
    }).body,
);
var secret = null;
settings.ui.nodes.forEach(function (node) {
    if (node.attributes.id === "totp_secret_key") secret = node.attributes.text.text;
});
if (secret === null) throw new Error("the settings flow offered no authenticator secret");
var code = http.post(CONTROL_URL + "/totp", { body: secret });
if (code.status !== 200) throw new Error("the lane refused a code: " + code.body);
var saved = http.post(AUTH_URL + "/self-service/settings?flow=" + settings.id, {
    headers: { "Content-Type": "application/json", "X-Session-Token": token },
    body: JSON.stringify({ method: "totp", totp_code: code.body }),
});
if (saved.status !== 200) throw new Error("turning the authenticator on failed: " + saved.body);
output.recovery.secret = secret;
