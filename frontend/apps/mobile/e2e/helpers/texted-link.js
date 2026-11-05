// The bank authorization link in the newest text to PHONE (digits only), read from Mailpit.
if (typeof MAILPIT_URL === "undefined" || typeof E2E_NAMESPACE === "undefined")
    throw new Error(
        "MAILPIT_URL or E2E_NAMESPACE is not set: run the flows through the native lane",
    );
var mailpit = MAILPIT_URL;
var inbox = PHONE + "+" + E2E_NAMESPACE + "@sms.test";
var query = encodeURIComponent('to:"' + inbox + '"');
var link = null;
// Maestro's scripts can't sleep, so a count of polls can end before the text lands
var deadline = Date.now() + 30000;
while (link === null && Date.now() < deadline) {
    var found = json(http.get(mailpit + "/api/v1/search?query=" + query).body);
    if (found.messages && found.messages.length > 0) {
        var message = json(http.get(mailpit + "/api/v1/message/" + found.messages[0].ID).body);
        var match = /https?:\/\/\S+\/setup#token=[\w-]+/.exec(message.Text);
        if (match) link = match[0];
    }
}
if (link === null) throw new Error("no bank authorization link texted to " + inbox);
output.link = link;
