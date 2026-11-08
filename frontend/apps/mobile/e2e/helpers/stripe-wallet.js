// Reads CLIENT's wallet through the Stripe lane once the card ending DEFAULT is its default: the app's record and what Stripe holds.
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flow through the Stripe lane");
var wallet = null;
var refused = null;
// Maestro's scripts can't sleep, so a count of polls can end before the change lands
var deadline = Date.now() + 60000;
while (wallet === null && Date.now() < deadline) {
    var read = http.post(CONTROL_URL + "/wallet", { body: CLIENT });
    // a read Stripe or the lease check turns down once is retried until the deadline
    if (read.status !== 200) {
        refused = read.body;
        continue;
    }
    var found = json(read.body);
    if (found.app.some((m) => m.preferred && m.last4 === DEFAULT)) wallet = found;
}
if (wallet === null && refused !== null)
    throw new Error("the lane refused the wallet read: " + refused);
if (wallet === null) throw new Error("the card ending " + DEFAULT + " never became the default");
var held = wallet.stripe.methods.map((m) => m.id);
output.recorded = wallet.app
    .map((m) => m.method + ":" + m.last4 + ":" + (m.preferred ? "default" : "saved"))
    .join(",");
output.provider =
    "attached " +
    wallet.app.filter((m) => held.includes(m.provider_ref)).length +
    ", setups " +
    wallet.stripe.setups.map((s) => s.status).join(",") +
    ", charges " +
    wallet.stripe.intents.length;
