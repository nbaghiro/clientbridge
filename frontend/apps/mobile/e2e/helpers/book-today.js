// Books BODY's visit so it is under way or still to come today; the staff's day opens fully first.
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
var business = "bz_birchbark_" + E2E_NAMESPACE;
var headers = {
    "Content-Type": "application/json",
    "X-Session-Token": session.session_token,
    "X-Business-Id": business,
};
// the server's own offsets for the business zone, so dates match what the app shows
var offsets = json(http.get(API_URL + "/v1/zones").body).zones["America/Vancouver"];
var DAY = 86400000;
var MINUTE = 60000;
function offsetAt(ms) {
    var minutes = 0;
    offsets.forEach(function (o) {
        if (o[0] * 1000 <= ms) minutes = o[1];
    });
    return minutes * 60000;
}
function uuid() {
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () {
        return Math.floor(Math.random() * 16).toString(16);
    });
}
var visit = JSON.parse(BODY);
var weekPath = API_URL + "/v1/hours/" + visit.staff_id + "/week";
var week = json(http.get(weekPath, { headers: headers }).body);
// the API takes all seven days back, and a day with no hours set goes back as a day off
var days = [0, 1, 2, 3, 4, 5, 6].map(function (n) {
    return (
        week.days.filter(function (d) {
            return d.weekday === n;
        })[0] || { weekday: n, available: false }
    );
});
output.week = { path: weekPath, headers: headers, days: days, business: business };
var nowWall = Date.now() + offsetAt(Date.now());
var today = Math.floor(nowWall / DAY) * DAY;
// the hours API counts weekdays from Monday
var weekday = (new Date(today).getUTCDay() + 6) % 7;
var opened = http.post(weekPath, {
    headers: headers,
    body: JSON.stringify({
        request: {
            version: 2,
            device_id: uuid(),
            operation_id: uuid(),
            business_id: business,
            created_at: new Date().toISOString(),
        },
        expected_revision: week.revision,
        days: days.map(function (d) {
            return d.weekday === weekday
                ? { weekday: d.weekday, available: true, start_time: "00:00", end_time: "23:59" }
                : d;
        }),
    }),
});
if (opened.status !== 200) throw new Error("opening today's hours failed: " + opened.body);
output.booking = null;
// STARTED books one that began earlier today, a minute at a time back from a minute ago
var started = typeof STARTED !== "undefined";
if (started && nowWall < today + 2 * MINUTE) {
    // Maestro's scripts can't sleep, so just after midnight this spins until two minutes have begun
    var ready = Date.now() + today + 2 * MINUTE - nowWall;
    while (Date.now() < ready) continue;
    nowWall = Date.now() + offsetAt(Date.now());
}
var step = started ? -MINUTE : 5 * MINUTE;
var first = started
    ? Math.floor(nowWall / MINUTE) * MINUTE - MINUTE
    : Math.floor(nowWall / (5 * MINUTE)) * 5 * MINUTE;
var last = started ? today : today + (23 * 60 + 49) * MINUTE;
for (
    var wall = first;
    (started ? wall >= last : wall <= last) && output.booking === null;
    wall += step
) {
    var sent = http.request(API_URL + "/v1/bookings", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(
            Object.assign({}, visit, {
                starts_at: new Date(wall - offsetAt(wall)).toISOString(),
                notify: false,
            }),
        ),
    });
    if (sent.status === 201) output.booking = json(sent.body);
    else if (sent.status !== 409)
        throw new Error("POST /v1/bookings failed: " + sent.status + " " + sent.body);
    // ROOM keeps that many minutes free after the visit, for a flow that lengthens it
    if (output.booking !== null && typeof ROOM !== "undefined") {
        var path = API_URL + "/v1/bookings/" + output.booking.id;
        var longer = new Date(Date.parse(output.booking.ends_at) + Number(ROOM) * MINUTE);
        var check = http.post(path + "/check", {
            headers: headers,
            body: JSON.stringify({ ends_at: longer.toISOString() }),
        });
        if (check.status !== 200) throw new Error("checking room failed: " + check.body);
        if (!json(check.body).ok) {
            var freed = http.request(path, {
                method: "PATCH",
                headers: headers,
                body: JSON.stringify({ status: "canceled", notify: false }),
            });
            if (freed.status !== 200)
                throw new Error("canceling a tight visit failed: " + freed.body);
            output.booking = null;
        }
    }
}
if (output.booking === null)
    throw new Error(
        visit.staff_id +
            (started
                ? " has no free time earlier today; run later in the day"
                : " has no free ten minutes left today; run after midnight"),
    );
output.dayLabel =
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(today).getUTCDay()] +
    " " +
    new Date(today).getUTCDate();
