// Asks the native lane for a client's committed notes (ACTION notes) or to start or finish a client photo upload as the web does (ACTION client-photo); the answer is in output.answer.
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flows through the native lane");
var sent = http.post(CONTROL_URL + "/" + ACTION, { body: PAYLOAD });
if (sent.status !== 200) throw new Error("the lane refused " + ACTION + ": " + sent.body);
output.answer = json(sent.body);
