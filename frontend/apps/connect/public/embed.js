// Generated from src/embedLoader.ts by `make gen-strings`. Use: <script src=".../embed.js" async></script>
// then <connect-booking slug="…"> or <connect-pay|form|contract|review token="…">; each fires connect:success.
(function () {
    "use strict";
    const TYPES = {
        "connect-booking": { widget: "booking", path: "/b/", attr: "slug", suffix: "/book" },
        "connect-pay": { widget: "pay", path: "/i/", attr: "token" },
        "connect-form": { widget: "form", path: "/form/", attr: "token" },
        "connect-contract": { widget: "contract", path: "/contract/", attr: "token" },
        "connect-review": { widget: "review", path: "/review/", attr: "token" },
    };
    const DRAWER_STYLE = `
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
    const INLINE_STYLE =
        ":host{display:block;font:14px system-ui,sans-serif;color:#202b34}.frame{overflow:hidden;border:1px solid #e5e7eb;border-radius:24px;background:#fff;box-shadow:0 24px 60px -36px #141e1940}header{display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid #e5e7eb}header[hidden],footer:empty{display:none}img{width:28px;height:28px;object-fit:contain;border-radius:8px}strong{font-size:14px}footer{border-top:1px solid #e5e7eb;text-align:center;padding:12px;font-size:11px;color:#6b7280}";
    function originOf(u) {
        try {
            return new URL(u).origin;
        } catch {
            return u;
        }
    }
    function attr(el, name) {
        const value = el.getAttribute(name);
        return value === "" ? null : value;
    }
    function isBrand(value) {
        return (
            typeof value === "object" &&
            value !== null &&
            "name" in value &&
            typeof value.name === "string"
        );
    }
    function brandColours(host, value) {
        if (typeof value !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return;
        const primary =
            value.length === 4
                ? "#" +
                  value
                      .slice(1)
                      .split("")
                      .map((c) => c + c)
                      .join("")
                : value;
        host.style.setProperty("--brand", primary);
        const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
            const channel = parseInt(primary.slice(at, at + 2), 16) / 255;
            return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        host.style.setProperty(
            "--brand-ink",
            0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000" : "#fff",
        );
    }
    function publicImage(mark, base) {
        if (typeof mark !== "string") return null;
        try {
            const url = new URL(mark, base);
            return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
        } catch {
            return null;
        }
    }
    function loadEmbeds(text) {
        const thisScript = document.currentScript;
        const configured = window.CONNECT_BASE ?? "";
        const DEFAULT_BASE = originOf(
            configured !== ""
                ? configured
                : thisScript instanceof HTMLScriptElement
                  ? thisScript.src
                  : window.location.href,
        );
        let registry = [];
        function drawer(host, iframe, base, title) {
            const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = DRAWER_STYLE;
            const launch = document.createElement("button");
            launch.type = "button";
            launch.className = "launch";
            launch.setAttribute("aria-haspopup", "dialog");
            launch.setAttribute("aria-expanded", "false");
            const launchMark = document.createElement("span");
            launchMark.className = "mark";
            launchMark.setAttribute("aria-hidden", "true");
            launchMark.textContent = "+";
            const label = document.createElement("span");
            label.textContent = attr(host, "label") ?? title;
            launch.append(launchMark, label);
            const dialog = document.createElement("dialog");
            dialog.setAttribute("aria-label", title);
            const header = document.createElement("header");
            const mark = launchMark.cloneNode(true);
            const titles = document.createElement("div");
            titles.className = "titles";
            const heading = document.createElement("h2");
            heading.textContent = title;
            const business = document.createElement("p");
            business.className = "business";
            titles.append(heading, business);
            const close = document.createElement("button");
            close.type = "button";
            close.className = "close";
            close.setAttribute("aria-label", attr(host, "close-label") ?? text.close);
            close.textContent = "×";
            close.addEventListener("click", () => {
                dialog.close();
            });
            launch.addEventListener("click", () => {
                dialog.showModal();
                launch.hidden = true;
                launch.setAttribute("aria-expanded", "true");
                close.focus();
                iframe.contentWindow?.postMessage(
                    { source: "clientbridge-host", type: "ready" },
                    base,
                );
            });
            dialog.addEventListener("close", () => {
                launch.hidden = false;
                launch.setAttribute("aria-expanded", "false");
                launch.focus();
            });
            dialog.addEventListener("click", (event) => {
                if (event.target !== dialog) return;
                const bounds = dialog.getBoundingClientRect();
                if (
                    event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom
                )
                    dialog.close();
            });
            iframe.style.height = "100%";
            const content = document.createElement("div");
            content.className = "content";
            content.appendChild(iframe);
            const footer = document.createElement("footer");
            header.append(mark, titles, close);
            dialog.append(header, content, footer);
            root.append(style, launch, dialog);
            return {
                dismiss: () => {
                    if (dialog.open) dialog.close();
                },
                updateBrand: (brand) => {
                    if (!isBrand(brand)) return;
                    const initial = brand.name.slice(0, 1);
                    business.textContent = brand.name.slice(0, 160);
                    if (typeof brand.title === "string") {
                        heading.textContent = brand.title.slice(0, 160);
                        dialog.setAttribute("aria-label", heading.textContent);
                    }
                    if (typeof brand.footer === "string")
                        footer.textContent = brand.footer.slice(0, 240);
                    brandColours(host, brand.primary);
                    const src = publicImage(brand.mark, base);
                    [mark, launchMark].forEach((slot) => {
                        slot.textContent = initial;
                        if (src === null) return;
                        const image = document.createElement("img");
                        image.alt = "";
                        image.src = src;
                        image.addEventListener("error", () => {
                            slot.textContent = initial;
                        });
                        slot.replaceChildren(image);
                    });
                },
            };
        }
        function inline(host, iframe, base, title) {
            const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = INLINE_STYLE;
            const frame = document.createElement("section");
            frame.className = "frame";
            frame.setAttribute("aria-label", title);
            const header = document.createElement("header");
            header.hidden = true;
            const name = document.createElement("strong");
            header.append(name);
            const footer = document.createElement("footer");
            frame.append(header, iframe, footer);
            root.append(style, frame);
            return {
                dismiss: () => undefined,
                updateBrand: (brand) => {
                    if (!isBrand(brand)) return;
                    name.textContent = brand.name.slice(0, 160);
                    header.hidden = false;
                    if (typeof brand.footer === "string")
                        footer.textContent = brand.footer.slice(0, 240);
                    header.querySelector("img")?.remove();
                    const src = publicImage(brand.mark, base);
                    if (src === null) return;
                    const image = document.createElement("img");
                    image.src = src;
                    image.alt = "";
                    image.addEventListener("error", () => {
                        image.remove();
                    });
                    header.prepend(image);
                },
            };
        }
        function define(tag, cfg) {
            if (customElements.get(tag)) return;
            customElements.define(
                tag,
                class extends HTMLElement {
                    frame = null;
                    connectedCallback() {
                        if (this.frame !== null) return;
                        const title = text.titles[cfg.widget];
                        const base = originOf(attr(this, "base") ?? DEFAULT_BASE);
                        const id = this.getAttribute(cfg.attr) ?? "";
                        const floating = this.getAttribute("mode") === "drawer";
                        const iframe = document.createElement("iframe");
                        iframe.src =
                            base +
                            cfg.path +
                            encodeURIComponent(id) +
                            (cfg.suffix ?? "") +
                            "?embed=1" +
                            (floating ? "&presentation=guided" : "");
                        iframe.title = title;
                        iframe.setAttribute("allow", "payment");
                        iframe.style.cssText =
                            "width:100%;border:0;display:block;overflow:hidden;height:200px;";
                        if (this.style.display === "") this.style.display = "block";
                        const parts = floating
                            ? drawer(this, iframe, base, title)
                            : inline(this, iframe, base, title);
                        this.frame = iframe;
                        registry.push({ host: this, iframe, base, floating, ...parts });
                    }
                    disconnectedCallback() {
                        registry = registry.filter((entry) => entry.host !== this);
                        this.replaceChildren();
                        this.shadowRoot?.replaceChildren();
                        this.frame = null;
                    }
                },
            );
        }
        Object.entries(TYPES).forEach(([tag, cfg]) => {
            define(tag, cfg);
        });
        const slug = thisScript === null ? null : attr(thisScript, "data-slug");
        if (thisScript !== null && slug !== null) {
            const launcher = document.createElement("connect-booking");
            const mode = attr(thisScript, "data-mode");
            const label = attr(thisScript, "data-label");
            launcher.setAttribute("slug", slug);
            launcher.setAttribute("mode", mode ?? "drawer");
            if (label !== null) launcher.setAttribute("label", label);
            if (mode === "inline") thisScript.after(launcher);
            else (document.body ?? document.documentElement).appendChild(launcher);
        }
        window.addEventListener("message", (e) => {
            const data = e.data;
            if (
                typeof data !== "object" ||
                data === null ||
                !("source" in data) ||
                data.source !== "clientbridge-connect" ||
                !("type" in data)
            )
                return;
            const entry = registry.find((r) => r.iframe.contentWindow === e.source);
            if (entry?.base !== e.origin) return;
            if (data.type === "resize" && "height" in data && typeof data.height === "number") {
                if (entry.floating) return;
                const height = Number.isFinite(data.height) ? data.height : 200;
                entry.iframe.style.height = String(Math.min(Math.max(height, 120), 20000)) + "px";
            } else if (data.type === "dismiss") {
                entry.dismiss();
            } else if (data.type === "brand") {
                entry.updateBrand("brand" in data ? data.brand : null);
            } else if (data.type === "success") {
                entry.host.dispatchEvent(
                    new CustomEvent("connect:success", {
                        bubbles: true,
                        detail: { widget: "widget" in data ? data.widget : undefined },
                    }),
                );
            }
        });
    }

    loadEmbeds({
        titles: {
            booking: "Book an appointment",
            pay: "Pay",
            form: "Complete form",
            contract: "Review & sign",
            review: "Leave a review",
        },
        close: "Close",
    });
})();
