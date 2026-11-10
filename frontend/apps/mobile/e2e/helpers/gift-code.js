// The gift card code texted to PHONE (Mailpit on the host), waiting up to 30 seconds for the text.
if (typeof MAILPIT_URL === "undefined")
    throw new Error("MAILPIT_URL is not set: run the flows through the native lane");
var inbox = PHONE.replace(/\D/g, "") + "+" + E2E_NAMESPACE + "@sms.test";
var query = encodeURIComponent('to:"' + inbox + '"');
var code = null;
// Maestro's scripts can't sleep, so a count of polls can end before the text lands
var deadline = Date.now() + 30000;
while (code === null && Date.now() < deadline) {
    var found = json(http.get(MAILPIT_URL + "/api/v1/search?limit=10&query=" + query).body);
    (found.messages || []).forEach(function (message) {
        var match = /\b([A-Z2-7]{12})\b/.exec(message.Snippet);
        if (match !== null) code = match[1];
    });
}
if (code === null) throw new Error("no gift card code was texted to " + PHONE);
output.code = code;
