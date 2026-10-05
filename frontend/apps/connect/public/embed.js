// Connect embed loader: <script src=".../embed.js" async></script> then <connect-booking slug="…">,
// <connect-pay|form|contract|review token="…">; each fires a bubbling `connect:success` event.
(function () {
    "use strict";

    var thisScript = document.currentScript;
    // A bare origin, so a configured base with a path still matches `e.origin`.
    function originOf(u) {
        try {
            return new URL(u).origin;
        } catch (e) {
            return u;
        }
    }
    var DEFAULT_BASE = originOf(
        window.CONNECT_BASE || (thisScript ? thisScript.src : window.location.href),
    );

    var TYPES = {
        "connect-booking": { path: "/book/", attr: "slug", title: "Book an appointment" },
        "connect-pay": { path: "/pay/", attr: "token", title: "Pay" },
        "connect-form": { path: "/form/", attr: "token", title: "Complete form" },
        "connect-contract": { path: "/contract/", attr: "token", title: "Review & sign" },
        "connect-review": { path: "/review/", attr: "token", title: "Leave a review" },
    };

    // host element ↔ iframe, so an incoming message can be routed to the widget that sent it
    var registry = [];

    function define(tag, cfg) {
        if (customElements.get(tag)) return;
        customElements.define(
            tag,
            class extends HTMLElement {
                connectedCallback() {
                    if (this._iframe) return;
                    var base = originOf(this.getAttribute("base") || DEFAULT_BASE);
                    var id = this.getAttribute(cfg.attr) || "";
                    var iframe = document.createElement("iframe");
                    iframe.src = base + cfg.path + encodeURIComponent(id) + "?embed=1";
                    iframe.title = cfg.title;
                    iframe.setAttribute("allow", "payment");
                    // Initial height only; the resize protocol must be free to shrink it.
                    iframe.style.cssText =
                        "width:100%;border:0;display:block;overflow:hidden;height:200px;";
                    if (this.style.display === "") this.style.display = "block";
                    this.appendChild(iframe);
                    this._iframe = iframe;
                    registry.push({ host: this, iframe: iframe, base: base });
                }
            },
        );
    }

    Object.keys(TYPES).forEach(function (tag) {
        define(tag, TYPES[tag]);
    });

    window.addEventListener("message", function (e) {
        var data = e.data;
        if (!data || data.source !== "clientbridge-connect") return;
        var entry = null;
        for (var i = 0; i < registry.length; i++) {
            if (registry[i].iframe.contentWindow === e.source) {
                entry = registry[i];
                break;
            }
        }
        if (!entry || e.origin !== entry.base) return; // only trust the widget's own origin
        if (data.type === "resize" && typeof data.height === "number") {
            entry.iframe.style.height = Math.max(data.height, 120) + "px";
        } else if (data.type === "success") {
            entry.host.dispatchEvent(
                new CustomEvent("connect:success", {
                    bubbles: true,
                    detail: { widget: data.widget },
                }),
            );
        }
    });
})();
