// Reads CLIENT's money through the Stripe lane once its payments read PAYMENTS (kind:status:cents,…) and the books hold what Stripe settled: the app's record and Stripe's.
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flow through the Stripe lane");
function summary(found) {
    return found.app.payments.map((p) => p.kind + ":" + p.status + ":" + p.amount_cents).join(",");
}
function charges(found) {
    return found.stripe.filter((i) => i.charge !== null).map((i) => i.charge);
}
function settled(found) {
    var paid = charges(found);
    var net = paid.reduce((sum, c) => sum + c.net_cents, 0);
    var fees = paid.reduce(
        (sum, c) => sum + c.transactions.reduce((all, row) => all + row.fee, 0),
        0,
    );
    var booked = found.app.totals;
    return (
        (booked.stripe || 0) === net &&
        (booked.processing_fee || 0) + (booked.platform_fee || 0) === fees
    );
}
var money = null;
var last = null;
var refused = null;
// Maestro can't sleep and a card-present charge can take minutes to book, so poll against a clock
var deadline = Date.now() + 300000;
while (money === null && Date.now() < deadline) {
    var read = http.post(CONTROL_URL + "/money", { body: CLIENT });
    if (read.status !== 200) {
        refused = read.body;
        continue;
    }
    last = json(read.body);
    if (summary(last) === PAYMENTS && settled(last)) money = last;
}
if (money === null && last === null && refused !== null)
    throw new Error("the lane refused the money read: " + refused);
if (money === null)
    throw new Error("the client's payments never read " + PAYMENTS + ": " + JSON.stringify(last));
var paid = charges(money);
output.balanced = money.app.balanced;
output.intents = money.stripe
    .map((i) => i.payment_method_types.join("+") + ":" + i.status + ":" + i.amount)
    .join(",");
output.refunds = paid
    .map((c) => c.refunds.map((r) => r.status + ":" + r.amount).join("+"))
    .join(",");
output.refunded = paid.reduce((sum, c) => sum + c.charge.amount_refunded, 0);
output.net = paid.reduce((sum, c) => sum + c.net_cents, 0);
output.fees = paid.reduce(
    (sum, c) => sum + c.transactions.reduce((all, row) => all + row.fee, 0),
    0,
);
output.revenue = money.app.totals.revenue || 0;
// the Payouts figures as patterns of what the screen shows, such as \$1,234.56
function shown(cents) {
    var dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "\\$" + dollars + "." + String(cents % 100).padStart(2, "0");
}
output.awaitingShown = shown(money.app.books.awaiting);
output.feesShown = shown(money.app.books.fees);
output.netShown = shown(
    paid.reduce((sum, c) => sum + c.charge.amount - c.charge.amount_refunded, 0) - output.fees,
);
