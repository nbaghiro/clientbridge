// Accepts the estimate texted to PHONE as its client would, ticking the optional lines named in TICK.
if (typeof API_URL === "undefined" || typeof MAILPIT_URL === "undefined")
    throw new Error("API_URL or MAILPIT_URL is not set: run the flows through the native lane");
var inbox = PHONE.replace(/\D/g, "") + "+" + E2E_NAMESPACE + "@sms.test";
var query = encodeURIComponent('to:"' + inbox + '"');
var token = null;
// Maestro's scripts can't sleep, so a count of polls can end before the text lands
var deadline = Date.now() + 30000;
while (token === null && Date.now() < deadline) {
    var found = json(http.get(MAILPIT_URL + "/api/v1/search?query=" + query).body);
    if (found.messages && found.messages.length > 0) {
        var message = json(http.get(MAILPIT_URL + "/api/v1/message/" + found.messages[0].ID).body);
        var match = /\/e\/([\w-]+)/.exec(message.Text);
        if (match) token = match[1];
    }
}
if (token === null) throw new Error("no estimate link texted to " + inbox);
var page = json(http.get(API_URL + "/estimate/" + token).body);
var ids = page.lines
    .filter(function (line) {
        return line.optional && TICK.split("|").indexOf(line.description) >= 0;
    })
    .map(function (line) {
        return line.id;
    });
var quoted = json(
    http.get(
        API_URL +
            "/estimate/" +
            token +
            "?" +
            ids
                .map(function (id) {
                    return "line_ids=" + encodeURIComponent(id);
                })
                .join("&"),
    ).body,
);
var accepted = http.post(API_URL + "/estimate/" + token + "/accept", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ line_ids: ids, total_cents: quoted.total_cents }),
});
if (accepted.status !== 200)
    throw new Error("accepting the estimate failed: " + accepted.status + " " + accepted.body);
output.estimate = json(accepted.body);
