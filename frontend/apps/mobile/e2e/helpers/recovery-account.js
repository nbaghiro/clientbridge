// A throwaway verified identity, so recovery never changes a demo user's password.
var stamp = String(Date.now());
var email = "recovery-" + stamp + "@example.com";
var created = http.post("http://localhost:8714/admin/identities", {
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
