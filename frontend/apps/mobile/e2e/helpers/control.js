// Asks the native lane to take the app's services away or back (ACTION offline|online), deliver PAYLOAD as a push, set the payment account (account), add a library photo (photo), give an account a security key (key) or finish a bank authorization on the stand-in Stripe (bank).
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flows through the native lane");
var sent = http.post(CONTROL_URL + "/" + ACTION, {
    body: typeof PAYLOAD === "undefined" ? "" : PAYLOAD,
});
if (sent.status !== 204) throw new Error("the lane refused " + ACTION + ": " + sent.body);
