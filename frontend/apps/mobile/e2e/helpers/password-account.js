// A throwaway verified identity with a password, so the flow can sign in before changing it.
if (typeof AUTH_ADMIN_URL === "undefined" || typeof E2E_NAMESPACE === "undefined")
    throw new Error(
        "AUTH_ADMIN_URL or E2E_NAMESPACE is not set: run the flows through the native lane",
    );
var authAdmin = AUTH_ADMIN_URL;
var email = "password-" + String(Date.now()) + "+" + E2E_NAMESPACE + "@example.com";
var password = "Juniper-Harbour-" + Math.random().toString(36).slice(2, 8);
var created = http.post(authAdmin + "/admin/identities", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        schema_id: "default",
        traits: { email: email, name: "Password Check" },
        credentials: { password: { config: { password: password } } },
        verifiable_addresses: [{ value: email, via: "email", verified: true, status: "completed" }],
    }),
});
output.recovery = {
    email: email,
    id: json(created.body).id,
    password: password,
    newPassword: "Cedar-Lantern-" + Math.random().toString(36).slice(2, 8),
};
