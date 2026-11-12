// Asks the native lane to bill a GST and PST sale into the tax business's last quarter; output.quarter holds its start, end and title.
if (typeof CONTROL_URL === "undefined")
    throw new Error("CONTROL_URL is not set: run the flows through the native lane");
var sent = http.post(CONTROL_URL + "/tax-quarter", { body: output.tax.business });
if (sent.status !== 200) throw new Error("the lane refused tax-quarter: " + sent.body);
var quarter = json(sent.body);
quarter.title =
    "Q" +
    String(Math.floor((Number(quarter.start.slice(5, 7)) - 1) / 3) + 1) +
    " " +
    quarter.start.slice(0, 4);
output.quarter = quarter;
