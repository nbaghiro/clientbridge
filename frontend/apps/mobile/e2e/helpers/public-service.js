// Reads service NAME from the run's Birchbark booking page, with the least gap between STAFF_ID's starts.
if (typeof API_URL === "undefined")
    throw new Error("API_URL is not set: run the flows through the native lane");
var book = API_URL + "/book/birchbark-" + E2E_NAMESPACE;
var page = json(http.get(book + "/services").body);
var found = page.services.filter(function (service) {
    return service.name === NAME;
})[0];
if (!found) throw new Error("the booking page doesn't list " + NAME);
var gap = null;
for (var offset = 14; offset < 28 && gap !== 70; offset++) {
    // any day in the window will do, so a UTC date stands in for the business's own
    var date = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    var slots = json(
        http.get(book + "/slots?item_id=" + found.id + "&staff_id=" + STAFF_ID + "&date=" + date)
            .body,
    ).slots;
    for (var i = 1; i < slots.length; i++) {
        var minutes = (Date.parse(slots[i].starts_at) - Date.parse(slots[i - 1].starts_at)) / 60000;
        if (gap === null || minutes < gap) gap = minutes;
    }
}
output.service = {
    price: found.price_cents,
    minutes: found.duration_min,
    deposit: found.deposit_amount_cents,
    staff: found.staff_ids.slice().sort().join(","),
    gap: gap,
};
