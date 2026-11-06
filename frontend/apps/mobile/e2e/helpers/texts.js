// How many texts PHONE received that contain WORDS, waiting up to 30 seconds for one (Mailpit on the host).
if (typeof MAILPIT_URL === "undefined")
    throw new Error("MAILPIT_URL is not set: run the flows through the native lane");
var inbox = PHONE.replace(/\D/g, "") + "+" + E2E_NAMESPACE + "@sms.test";
var query = encodeURIComponent('to:"' + inbox + '"');
var matching = [];
// Maestro's scripts can't sleep, so a count of polls can end before the text lands
var deadline = Date.now() + 30000;
while (matching.length === 0 && Date.now() < deadline) {
    var found = json(http.get(MAILPIT_URL + "/api/v1/search?limit=50&query=" + query).body);
    matching = (found.messages || []).filter(function (message) {
        return message.Snippet.indexOf(WORDS) >= 0;
    });
}
output.texts = matching.length;
