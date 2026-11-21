// Opens LINK as the client's browser would, through the public read its Connect page makes.
if (typeof API_URL === "undefined")
    throw new Error("API_URL is not set: run the flows through the native lane");
var routes = [
    [/\/i\/([^/?#]+)$/, "/pay/", ""],
    [/\/e\/([^/?#]+)$/, "/estimate/", ""],
    [/\/r\/([^/?#]+)$/, "/receipt/", ""],
    [/\/m\/([^/?#]+)$/, "/manage/", "/receipt"],
];
var route = routes.filter(function (r) {
    return r[0].test(LINK);
})[0];
if (!route) throw new Error(LINK + " is not a page a client opens");
var opened = http.get(API_URL + route[1] + LINK.match(route[0])[1] + route[2]);
if (opened.status !== 200)
    throw new Error(LINK + " opened with " + opened.status + " " + opened.body);
output.page = json(opened.body);
