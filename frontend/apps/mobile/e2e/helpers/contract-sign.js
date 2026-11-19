// Signs the contract texted to PHONE as its client would, with SIGNER typed as the name.
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
        var match = /\/contract\/([\w-]+)/.exec(message.Text);
        if (match) token = match[1];
    }
}
if (token === null) throw new Error("no contract link texted to " + inbox);
var contract = json(http.get(API_URL + "/contract/" + token).body);
var signed = http.post(API_URL + "/contract/" + token + "/sign", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        version: contract.version,
        typed_name: SIGNER,
        strokes: null,
        agreed: true,
    }),
});
if (signed.status !== 200)
    throw new Error("signing the contract failed: " + signed.status + " " + signed.body);
output.contract = json(signed.body);
