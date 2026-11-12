// Changes the tax business from tax-business.js as another device would: METHOD on PATH with BODY (and KEY as its retry key).
if (typeof API_URL === "undefined")
    throw new Error("API_URL is not set: run the flows through the native lane");
var sent = http.request(API_URL + PATH, {
    method: METHOD,
    headers: Object.assign(
        {
            "Content-Type": "application/json",
            "X-Session-Token": output.tax.token,
            "X-Business-Id": output.tax.business,
        },
        typeof KEY === "undefined" ? {} : { "Idempotency-Key": KEY },
    ),
    body: typeof BODY === "undefined" ? "{}" : BODY,
});
if (sent.status >= 300)
    throw new Error(METHOD + " " + PATH + " failed: " + sent.status + " " + sent.body);
output.response = json(sent.body);
