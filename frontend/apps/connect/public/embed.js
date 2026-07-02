/*
 * Clientbridge Connect — embed loader.
 *
 * A business drops this on their own site to embed a customer widget:
 *
 *   <script src="https://connect.example.com/embed.js" async></script>
 *   <connect-booking slug="birchbark"></connect-booking>
 *   <connect-pay token="PAY_TOKEN"></connect-pay>
 *   <connect-form token="FORM_TOKEN"></connect-form>
 *   <connect-contract token="SIGN_TOKEN"></connect-contract>
 *   <connect-review token="REVIEW_TOKEN"></connect-review>
 *
 * Each element renders the matching Connect page inside an <iframe> (so it's isolated from the host
 * page's CSS/JS), auto-resizes to fit its content, and emits a bubbling `connect:success` DOM event
 * when the flow completes:
 *
 *   document.addEventListener("connect:success", function (e) {
 *     // e.detail.widget is "booking" | "pay" | "form" | "contract" | "review"
 *   });
 *
 * The Connect origin is inferred from this script's own URL; override per element with `base="…"`,
 * or globally with `window.CONNECT_BASE` before the script loads. No script tag? A plain
 * `<iframe src="https://connect.example.com/book/birchbark?embed=1">` also works (without auto-resize).
 */
(function () {
    "use strict";

    var thisScript = document.currentScript;
    // Normalize to a bare origin (scheme://host:port) — tolerates a configured base with a trailing
    // slash or path, which would otherwise fail the `e.origin === base` check + double-slash the src.
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
                    // Initial height only (a pre-message flash); the resize protocol sets it precisely
                    // and must be free to shrink, so no min-height floor here.
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
