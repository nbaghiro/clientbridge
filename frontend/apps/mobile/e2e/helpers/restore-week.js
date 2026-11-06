// Puts back the working week book-today.js opened, so later flows see the seeded hours.
if (output.week) {
    var current = json(http.get(output.week.path, { headers: output.week.headers }).body);
    var restored = http.post(output.week.path, {
        headers: output.week.headers,
        body: JSON.stringify({
            request: {
                version: 2,
                device_id: "00000000-0000-4000-8000-000000000001",
                operation_id: "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () {
                    return Math.floor(Math.random() * 16).toString(16);
                }),
                business_id: output.week.business,
                created_at: new Date().toISOString(),
            },
            expected_revision: current.revision,
            days: output.week.days,
        }),
    });
    if (restored.status !== 200) throw new Error("restoring the week failed: " + restored.body);
}
