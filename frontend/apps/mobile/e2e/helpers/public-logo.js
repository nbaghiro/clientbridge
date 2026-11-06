// The logo Birchbark's public pages show, fetched as a browser would, so a flow can tell it changed.
if (typeof API_URL === "undefined" || typeof E2E_NAMESPACE === "undefined")
    throw new Error("API_URL or E2E_NAMESPACE is not set: run the flows through the native lane");
var page = json(http.get(API_URL + "/book/birchbark-" + E2E_NAMESPACE + "/services").body);
var url = page.brand.logo_url;
output.logo = { url: url, type: null };
if (url) {
    var image = http.get(url);
    if (image.status !== 200) throw new Error("the public logo answered " + image.status);
    output.logo.type = image.headers["content-type"] || image.headers["Content-Type"];
}
