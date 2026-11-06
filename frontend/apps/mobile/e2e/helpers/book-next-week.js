// Books BODY's visit at its staff's first open half hour in the week Schedule shows after one Next.
if (typeof API_URL === "undefined" || typeof AUTH_URL === "undefined")
    throw new Error("API_URL or AUTH_URL is not set: run the flows through the native lane");
var flow = json(http.get(AUTH_URL + "/self-service/login/api").body);
var session = json(
    http.post(AUTH_URL + "/self-service/login?flow=" + flow.id, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            method: "password",
            identifier: "hannah+" + E2E_NAMESPACE + "@birchbark.example",
            password: "demo1234",
        }),
    }).body,
);
var headers = {
    "Content-Type": "application/json",
    "X-Session-Token": session.session_token,
    "X-Business-Id": "bz_birchbark_" + E2E_NAMESPACE,
};
// the server's own offsets for the business zone, so dates match what the app shows
var offsets = json(http.get(API_URL + "/v1/zones").body).zones["America/Vancouver"];
var DAY = 86400000;
var HOUR = 3600000;
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function offsetAt(ms) {
    var minutes = 0;
    offsets.forEach(function (o) {
        if (o[0] * 1000 <= ms) minutes = o[1];
    });
    return minutes * 60000;
}
function localDay(ms) {
    return Math.floor((ms + offsetAt(ms)) / DAY) * DAY;
}
var visit = JSON.parse(BODY);
// with SLUG a new client asks for the visit on that booking page instead
var online = typeof SLUG !== "undefined";
var today = localDay(Date.now());
var anchor = today + 7 * DAY;
// the app's weeks start on Monday
var first = anchor - ((new Date(anchor).getUTCDay() + 6) % 7) * DAY;
output.booking = null;
for (var d = 0; d < 7 && output.booking === null; d++) {
    var day = first + d * DAY;
    if (day <= today) continue;
    var hours = [10, 11, 13, 14, 15];
    for (var h = 0; h < hours.length && output.booking === null; h++) {
        var wall = day + hours[h] * HOUR;
        var sent = http.request(API_URL + (online ? "/book/" + SLUG : "/v1/bookings"), {
            method: "POST",
            headers: online ? { "Content-Type": "application/json" } : headers,
            body: JSON.stringify(
                Object.assign(
                    {},
                    visit,
                    { starts_at: new Date(wall - offsetAt(wall)).toISOString() },
                    online ? {} : { notify: false },
                ),
            ),
        });
        if (sent.status === (online ? 200 : 201)) {
            output.booking = json(sent.body);
            output.dayLabel =
                WEEKDAYS[new Date(day).getUTCDay()] + " " + new Date(day).getUTCDate();
        } else if (sent.status !== 409) {
            throw new Error("booking failed: " + sent.status + " " + sent.body);
        }
    }
}
if (output.booking === null) throw new Error(visit.staff_id + " has no open half hour next week");
