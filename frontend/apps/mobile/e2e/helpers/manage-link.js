// Does ACTION ("move" or "cancel") from the client's manage link TOKEN, as Connect would.
if (typeof API_URL === "undefined")
    throw new Error("API_URL is not set: run the flows through the native lane");
var base = API_URL + "/manage/" + TOKEN;
var key = {
    "Content-Type": "application/json",
    "Idempotency-Key": ACTION + "-" + TOKEN + "-" + Date.now(),
};
if (ACTION === "move") {
    var visit = json(http.get(base).body);
    // the server's own offsets for the business zone, so the visit's day is the business's day
    var offsets = json(http.get(API_URL + "/v1/zones").body).zones[visit.timezone];
    var start = Date.parse(visit.starts_at);
    var minutes = 0;
    offsets.forEach(function (o) {
        if (o[0] * 1000 <= start) minutes = o[1];
    });
    var day = new Date(start + minutes * 60000).toISOString().slice(0, 10);
    var slots = json(http.get(base + "/slots?date=" + day).body).slots;
    if (slots.length === 0) throw new Error("no other time on " + day + " to move to");
    var moved = http.post(base + "/reschedule", {
        headers: key,
        body: JSON.stringify({ starts_at: slots[0].starts_at }),
    });
    if (moved.status !== 200) throw new Error("move failed: " + moved.status + " " + moved.body);
    output.managed = json(moved.body);
} else {
    var canceled = http.post(base + "/cancel", { headers: key, body: "{}" });
    if (canceled.status !== 200)
        throw new Error("cancel failed: " + canceled.status + " " + canceled.body);
    output.managed = json(canceled.body);
}
