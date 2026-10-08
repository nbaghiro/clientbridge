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
        "connect-pay": { path: "/i/", attr: "token", title: "Pay" },
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
                    iframe.src =
                        base +
                        cfg.path +
                        encodeURIComponent(id) +
                        "?embed=1" +
                        (this.getAttribute("mode") === "drawer" ? "&presentation=guided" : "");
                    iframe.title = cfg.title;
                    iframe.setAttribute("allow", "payment");
                    // Initial height only; the resize protocol must be free to shrink it.
                    iframe.style.cssText =
                        "width:100%;border:0;display:block;overflow:hidden;height:200px;";
                    if (this.style.display === "") this.style.display = "block";
                    var floating = this.getAttribute("mode") === "drawer";
                    var updateBrand = function () {};
                    var dismiss = function () {};
                    if (floating) {
                        var root = this.shadowRoot || this.attachShadow({ mode: "open" });
                        var style = document.createElement("style");
                        style.textContent = `
                            :host { --brand:#202b34; --brand-ink:#fff; font:14px system-ui,sans-serif; color:#202b34; }
                            * { box-sizing:border-box; }
                            button { font:inherit; cursor:pointer; }
                            button:focus-visible { outline:3px solid var(--brand); outline-offset:3px; }
                            .launch { position:fixed;right:24px;bottom:24px;z-index:2147483645;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);border:0;border-radius:999px;padding:10px 22px 10px 10px;background:var(--brand);color:var(--brand-ink);font-weight:600;font-size:16px;box-shadow:0 5px 24px #0003; }
                            .launch[hidden] { display:none; }
                            .mark { width:32px;height:32px;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#fff;color:#202b34;font-size:17px;font-weight:700; }
                            .mark img { width:100%;height:100%;object-fit:contain;padding:3px; }
                            dialog { position:fixed;inset:0 0 0 auto;margin:0;height:100dvh;max-height:100dvh;width:min(100vw,440px);max-width:100vw;border:0;border-radius:24px 0 0 24px;padding:0;box-shadow:-8px 0 32px #0003;background:#fff;color:#202b34;overflow:hidden; }
                            dialog[open] { display:flex;flex-direction:column; }
                            dialog::backdrop { background:#0006;backdrop-filter:blur(2px); }
                            header { position:relative;display:flex;align-items:center;gap:10px;flex:none;padding:14px 20px;border-bottom:1px solid #e5e7eb; }
                            .titles { flex:1;min-width:0; }
                            h2 { margin:0;font-size:18px;line-height:1.4; }
                            .business { margin:2px 0 0;font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
                            .close { border:0;background:transparent;color:inherit;width:36px;height:36px;border-radius:8px;font-size:24px;line-height:1; }
                            .close:hover { background:#f3f4f6; }
                            .content { min-height:0;flex:1;overflow:auto;overscroll-behavior:contain; }
                            footer { flex:none;border-top:1px solid #e5e7eb;padding:12px 20px max(12px,env(safe-area-inset-bottom));text-align:center;font-size:11px;color:#6b7280; }
                            footer:empty,.business:empty { display:none; }
                            @media(max-width:639px) { .launch { right:16px;bottom:16px; } dialog { inset:auto 0 0 0;width:100%;height:92dvh;max-height:92dvh;border-radius:24px 24px 0 0; } header { padding-top:22px; } header:before { content:"";position:absolute;width:40px;height:4px;background:#d1d5db;border-radius:999px;top:7px;left:calc(50% - 20px); } }
                        `;
                        var launch = document.createElement("button");
                        launch.type = "button";
                        launch.className = "launch";
                        launch.setAttribute("aria-haspopup", "dialog");
                        launch.setAttribute("aria-expanded", "false");
                        var launchMark = document.createElement("span");
                        launchMark.className = "mark";
                        launchMark.setAttribute("aria-hidden", "true");
                        launchMark.textContent = "+";
                        var label = document.createElement("span");
                        label.textContent = this.getAttribute("label") || cfg.title;
                        launch.append(launchMark, label);
                        var dialog = document.createElement("dialog");
                        dialog.setAttribute("aria-label", cfg.title);
                        dismiss = function () {
                            if (dialog.open) dialog.close();
                        };
                        var header = document.createElement("header");
                        var mark = launchMark.cloneNode(true);
                        var titles = document.createElement("div");
                        titles.className = "titles";
                        var title = document.createElement("h2");
                        title.textContent = cfg.title;
                        var business = document.createElement("p");
                        business.className = "business";
                        titles.append(title, business);
                        var close = document.createElement("button");
                        close.type = "button";
                        close.className = "close";
                        close.setAttribute(
                            "aria-label",
                            this.getAttribute("close-label") || "Close",
                        );
                        close.textContent = "×";
                        close.addEventListener("click", function () {
                            dialog.close();
                        });
                        launch.addEventListener("click", function () {
                            dialog.showModal();
                            launch.hidden = true;
                            launch.setAttribute("aria-expanded", "true");
                            close.focus();
                            iframe.contentWindow.postMessage(
                                { source: "clientbridge-host", type: "ready" },
                                base,
                            );
                        });
                        dialog.addEventListener("close", function () {
                            launch.hidden = false;
                            launch.setAttribute("aria-expanded", "false");
                            launch.focus();
                        });
                        dialog.addEventListener("click", function (event) {
                            if (event.target === dialog) {
                                var bounds = dialog.getBoundingClientRect();
                                if (
                                    event.clientX < bounds.left ||
                                    event.clientX > bounds.right ||
                                    event.clientY < bounds.top ||
                                    event.clientY > bounds.bottom
                                )
                                    dialog.close();
                            }
                        });
                        iframe.style.height = "100%";
                        var content = document.createElement("div");
                        content.className = "content";
                        content.appendChild(iframe);
                        var footer = document.createElement("footer");
                        header.append(mark, titles, close);
                        dialog.append(header, content, footer);
                        root.append(style, launch, dialog);
                        var host = this;
                        updateBrand = function (brand) {
                            if (!brand || typeof brand.name !== "string") return;
                            business.textContent = brand.name.slice(0, 160);
                            if (typeof brand.title === "string") {
                                title.textContent = brand.title.slice(0, 160);
                                dialog.setAttribute("aria-label", title.textContent);
                            }
                            if (typeof brand.footer === "string")
                                footer.textContent = brand.footer.slice(0, 240);
                            if (
                                typeof brand.primary === "string" &&
                                /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand.primary)
                            ) {
                                var primary =
                                    brand.primary.length === 4
                                        ? "#" +
                                          brand.primary
                                              .slice(1)
                                              .split("")
                                              .map(function (value) {
                                                  return value + value;
                                              })
                                              .join("")
                                        : brand.primary;
                                host.style.setProperty("--brand", primary);
                                var rgb = [1, 3, 5].map(function (at) {
                                    var value = parseInt(primary.slice(at, at + 2), 16) / 255;
                                    return value <= 0.04045
                                        ? value / 12.92
                                        : Math.pow((value + 0.055) / 1.055, 2.4);
                                });
                                host.style.setProperty(
                                    "--brand-ink",
                                    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
                                        ? "#000"
                                        : "#fff",
                                );
                            }
                            [mark, launchMark].forEach(function (slot) {
                                slot.textContent = brand.name.slice(0, 1);
                                if (typeof brand.mark !== "string") return;
                                try {
                                    var url = new URL(brand.mark, base);
                                    if (url.protocol !== "https:" && url.protocol !== "http:")
                                        return;
                                    var image = document.createElement("img");
                                    image.alt = "";
                                    image.src = url.href;
                                    image.addEventListener("error", function () {
                                        slot.textContent = brand.name.slice(0, 1);
                                    });
                                    slot.replaceChildren(image);
                                } catch (error) {
                                    /* Invalid public image URLs keep the initial. */
                                }
                            });
                        };
                    } else {
                        var inlineRoot = this.shadowRoot || this.attachShadow({ mode: "open" });
                        var inlineStyle = document.createElement("style");
                        inlineStyle.textContent =
                            ":host{display:block;font:14px system-ui,sans-serif;color:#202b34}.frame{overflow:hidden;border:1px solid #e5e7eb;border-radius:24px;background:#fff;box-shadow:0 24px 60px -36px #141e1940}header{display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid #e5e7eb}header[hidden],footer:empty{display:none}img{width:28px;height:28px;object-fit:contain;border-radius:8px}strong{font-size:14px}footer{border-top:1px solid #e5e7eb;text-align:center;padding:12px;font-size:11px;color:#6b7280}";
                        var inlineFrame = document.createElement("section");
                        inlineFrame.className = "frame";
                        inlineFrame.setAttribute("aria-label", cfg.title);
                        var inlineHeader = document.createElement("header");
                        inlineHeader.hidden = true;
                        var inlineTitle = document.createElement("strong");
                        inlineHeader.append(inlineTitle);
                        var inlineFooter = document.createElement("footer");
                        inlineFrame.append(inlineHeader, iframe, inlineFooter);
                        inlineRoot.append(inlineStyle, inlineFrame);
                        updateBrand = function (brand) {
                            if (!brand || typeof brand.name !== "string") return;
                            inlineTitle.textContent = brand.name.slice(0, 160);
                            inlineHeader.hidden = false;
                            if (typeof brand.footer === "string")
                                inlineFooter.textContent = brand.footer.slice(0, 240);
                            var previous = inlineHeader.querySelector("img");
                            if (previous) previous.remove();
                            if (typeof brand.mark !== "string") return;
                            try {
                                var url = new URL(brand.mark, base);
                                if (url.protocol !== "https:" && url.protocol !== "http:") return;
                                var image = document.createElement("img");
                                image.src = url.href;
                                image.alt = "";
                                image.addEventListener("error", function () {
                                    image.remove();
                                });
                                inlineHeader.prepend(image);
                            } catch (error) {
                                /* Keep the public business name if its image URL is invalid. */
                            }
                        };
                    }
                    this._iframe = iframe;
                    registry.push({
                        host: this,
                        iframe: iframe,
                        base: base,
                        floating: floating,
                        dismiss: dismiss,
                        updateBrand: updateBrand,
                    });
                }
                disconnectedCallback() {
                    registry = registry.filter((entry) => entry.host !== this);
                    this.replaceChildren();
                    if (this.shadowRoot) this.shadowRoot.replaceChildren();
                    this._iframe = null;
                }
            },
        );
    }

    Object.keys(TYPES).forEach(function (tag) {
        define(tag, TYPES[tag]);
    });

    if (thisScript && thisScript.getAttribute("data-slug")) {
        var launcher = document.createElement("connect-booking");
        launcher.setAttribute("slug", thisScript.getAttribute("data-slug"));
        launcher.setAttribute("mode", thisScript.getAttribute("data-mode") || "drawer");
        if (thisScript.getAttribute("data-label"))
            launcher.setAttribute("label", thisScript.getAttribute("data-label"));
        if (thisScript.getAttribute("data-mode") === "inline") thisScript.after(launcher);
        else (document.body || document.documentElement).appendChild(launcher);
    }

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
        if (data.type === "resize" && typeof data.height === "number" && !entry.floating) {
            entry.iframe.style.height =
                Math.min(Math.max(Number.isFinite(data.height) ? data.height : 200, 120), 20000) +
                "px";
        } else if (data.type === "dismiss") {
            entry.dismiss();
        } else if (data.type === "brand") {
            entry.updateBrand(data.brand);
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
