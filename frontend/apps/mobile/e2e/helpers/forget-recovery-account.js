if (typeof AUTH_ADMIN_URL === "undefined")
    throw new Error("AUTH_ADMIN_URL is not set: run the flows through the native lane");
var authAdmin = AUTH_ADMIN_URL;
if (output.recovery) http.delete(authAdmin + "/admin/identities/" + output.recovery.id);
