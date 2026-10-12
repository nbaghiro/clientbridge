// The six-digit code in the newest password-reset email to EMAIL (Mailpit on the host).
var query = encodeURIComponent('to:"' + EMAIL + '" subject:"password reset"');
var code = null;
for (var attempt = 0; attempt < 200 && code === null; attempt++) {
    var found = json(http.get("http://localhost:8715/api/v1/search?query=" + query).body);
    if (found.messages && found.messages.length > 0) {
        var message = json(
            http.get("http://localhost:8715/api/v1/message/" + found.messages[0].ID).body,
        );
        var match = /\b(\d{6})\b/.exec(message.Text);
        if (match) code = match[1];
    }
}
if (code === null) throw new Error("no reset code mailed to " + EMAIL);
output.code = code;
