// The authenticator code for output.recovery's secret now, from the lane.
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flows through the native lane");
var code = http.post(CONTROL_URL + "/totp", { body: output.recovery.secret });
if (code.status !== 200) throw new Error("the lane refused a code: " + code.body);
output.totp = code.body;
