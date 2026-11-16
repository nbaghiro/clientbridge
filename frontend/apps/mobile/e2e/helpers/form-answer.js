// Answers the form texted to PHONE as its client would: ANSWERS by question label, a PDF for each file question, signed as SIGNER.
if (typeof API_URL === "undefined" || typeof MAILPIT_URL === "undefined")
    throw new Error("API_URL or MAILPIT_URL is not set: run the flows through the native lane");
var inbox = PHONE.replace(/\D/g, "") + "+" + E2E_NAMESPACE + "@sms.test";
var query = encodeURIComponent('to:"' + inbox + '"');
var token = null;
// Maestro's scripts can't sleep, so a count of polls can end before the text lands
var deadline = Date.now() + 30000;
while (token === null && Date.now() < deadline) {
    var found = json(http.get(MAILPIT_URL + "/api/v1/search?query=" + query).body);
    if (found.messages && found.messages.length > 0) {
        var message = json(http.get(MAILPIT_URL + "/api/v1/message/" + found.messages[0].ID).body);
        var match = /\/form\/([\w-]+)/.exec(message.Text);
        if (match) token = match[1];
    }
}
if (token === null) throw new Error("no form link texted to " + inbox);
var form = json(http.get(API_URL + "/form/" + token).body);
var wanted = json(ANSWERS);
var answers = {};
var pdf = "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
form.fields.forEach(function (field) {
    if (field.input === "file") {
        var started = http.post(API_URL + "/form/" + token + "/upload", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content_type: "application/pdf", size: pdf.length }),
        });
        if (started.status !== 200) throw new Error("starting the upload failed: " + started.body);
        var upload = json(started.body);
        var put = http.request(upload.upload_url, {
            method: "PUT",
            headers: { "Content-Type": "application/pdf" },
            body: pdf,
        });
        if (put.status >= 300) throw new Error("the upload was refused: " + put.status);
        var done = http.post(
            API_URL + "/form/" + token + "/upload/" + upload.file_id + "/complete",
            { body: "" },
        );
        if (done.status !== 200) throw new Error("finishing the upload failed: " + done.body);
        answers[field.name] = upload.file_id;
    } else if (field.label in wanted) {
        answers[field.name] = wanted[field.label];
    }
});
var submitted = http.post(API_URL + "/form/" + token, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: answers, signature: { name: SIGNER, agreed: true } }),
});
if (submitted.status !== 200)
    throw new Error("submitting the form failed: " + submitted.status + " " + submitted.body);
output.form = form;
