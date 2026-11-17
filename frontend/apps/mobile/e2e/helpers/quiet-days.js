// Tomorrow as the app's calendar names it, and a pattern for 09:00 the day after, in the business zone.
if (typeof API_URL === "undefined")
    throw new Error("API_URL is not set: run the flows through the native lane");
// the server's own offsets for the business zone, so dates match what the app shows
var offsets = json(http.get(API_URL + "/v1/zones").body).zones["America/Vancouver"];
var DAY = 86400000;
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
function offsetAt(ms) {
    var minutes = 0;
    offsets.forEach(function (o) {
        if (o[0] * 1000 <= ms) minutes = o[1];
    });
    return minutes * 60000;
}
var now = Date.now();
var today = new Date(Math.floor((now + offsetAt(now)) / DAY) * DAY);
var tomorrow = new Date(today.getTime() + DAY);
var after = new Date(today.getTime() + 2 * DAY);
output.tomorrow =
    WEEKDAYS[tomorrow.getUTCDay()] +
    ", " +
    MONTHS[tomorrow.getUTCMonth()] +
    " " +
    String(tomorrow.getUTCDate());
// a pattern, since the month's short name comes from the phone's own date data
output.morning =
    "\\S+ " + String(after.getUTCDate()) + ", " + String(after.getUTCFullYear()) + ", 9:00";
