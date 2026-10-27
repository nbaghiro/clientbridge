// A throwaway verified identity in the run's namespace, so its reset mail reaches this run.
if (typeof AUTH_ADMIN_URL === "undefined" || typeof E2E_NAMESPACE === "undefined")
    throw new Error(
        "AUTH_ADMIN_URL or E2E_NAMESPACE is not set: run the flows through the native lane",
    );
var authAdmin = AUTH_ADMIN_URL;
var stamp = String(Date.now());
var email = "recovery-" + stamp + "+" + E2E_NAMESPACE + "@example.com";
var created = http.post(authAdmin + "/admin/identities", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        schema_id: "default",
        traits: { email: email, name: "Recovery Check" },
        verifiable_addresses: [{ value: email, via: "email", verified: true, status: "completed" }],
    }),
});
output.recovery = {
    email: email,
    id: json(created.body).id,
    password: "Juniper-Harbour-" + Math.random().toString(36).slice(2, 8),
};
