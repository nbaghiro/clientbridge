// Plays the client finishing the texted LINK: it opens Stripe's bank form, and the lane completes it.
if (typeof API_URL === "undefined" || typeof CONTROL_URL === "undefined")
    throw new Error("API_URL or CONTROL_URL is not set: run the flows through the native lane");
var started = http.post(API_URL + "/payment-method/start", {
    headers: {
        "Content-Type": "application/json",
        "X-Payment-Setup-Token": LINK.split("#token=")[1],
    },
    body: JSON.stringify({ email: "payer+" + E2E_NAMESPACE + "@example.com" }),
});
if (started.status !== 200) throw new Error("the setup page refused to start: " + started.body);
var intent = json(started.body).client_secret.split("_secret")[0];
var finished = http.post(CONTROL_URL + "/bank", { body: intent });
if (finished.status !== 204) throw new Error("the lane refused the bank: " + finished.body);
