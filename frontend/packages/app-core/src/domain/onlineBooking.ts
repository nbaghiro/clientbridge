import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import type { ApiLike } from "../api";
import { addDays, formatWeekday, relativeDayTime } from "../datetime";
import { formatMoney, initials } from "../format";
import { useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { bookingPageUrl } from "./business";
import { useReplicaLoad } from "./sync";

const s = strings.onlineBooking;
const p = s.policy;
const a = s.addons;

interface BookingPolicy {
    lead_hours: number;
    horizon_days: number;
    step_min: number | null;
    approve_new_clients: boolean;
    self_service: boolean;
    cancel_cutoff_hours: number;
    reschedule_cutoff_hours: number;
    late_cancel_deposit: "keep" | "refund";
    max_reschedules: number;
}

interface OnlineService {
    id: string;
    name: string;
    kind: string;
    duration_min: number | null;
    price_cents: number;
    color: string | null;
    deposit_type: string;
    deposit_cents: number;
    online_bookable: boolean;
}

interface OnlineStaff {
    id: string;
    name: string | null;
    title: string | null;
    color: string | null;
    bookable_online: boolean;
}

interface OnlineBookingOut {
    slug: string;
    business_name: string;
    policy: BookingPolicy;
    services: OnlineService[];
    staff: OnlineStaff[];
    online_30d: number;
    deposits_30d_cents: number;
}

interface Draft {
    policy: BookingPolicy;
    services: Record<string, boolean>;
    staff: Record<string, boolean>;
}

const draftOf = (out: OnlineBookingOut): Draft => ({
    policy: out.policy,
    services: Object.fromEntries(out.services.map((x) => [x.id, x.online_bookable])),
    staff: Object.fromEntries(out.staff.map((x) => [x.id, x.bookable_online])),
});

/** The settings endpoint shared by the booking page and the policy screens; saving re-reads it. */
function useOnlineDraft(api: ApiLike) {
    const remote = useRemote(() => api.get<OnlineBookingOut>("/v1/online-booking"));
    const [saved, setSaved] = useState<Draft | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [justSaved, setJustSaved] = useState(false);
    const { busy, error, run } = useAsyncAction();
    useEffect(() => {
        if (remote.data !== null && saved === null) {
            setSaved(draftOf(remote.data));
            setDraft(draftOf(remote.data));
        }
    }, [remote.data, saved]);
    const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
    const save = (fields: (keyof Draft)[], errorMessage: string): void => {
        if (draft === null || saved === null) return;
        const body: Record<string, unknown> = {};
        if (fields.includes("policy")) {
            const changes = Object.fromEntries(
                Object.entries(draft.policy).filter(
                    ([k, v]) => saved.policy[k as keyof BookingPolicy] !== v,
                ),
            );
            if ("step_min" in changes && changes.step_min === null) changes.step_min = 0;
            body.policy = changes;
        }
        if (fields.includes("services"))
            body.services = Object.fromEntries(
                Object.entries(draft.services).filter(([k, v]) => saved.services[k] !== v),
            );
        if (fields.includes("staff"))
            body.staff = Object.fromEntries(
                Object.entries(draft.staff).filter(([k, v]) => saved.staff[k] !== v),
            );
        run(
            async () => {
                const out = await api.patch<OnlineBookingOut>("/v1/online-booking", body);
                setSaved(draftOf(out));
                setDraft(draftOf(out));
                setJustSaved(true);
            },
            { errorMessage },
        );
    };
    return {
        remote,
        draft,
        setDraft: (fn: (d: Draft) => Draft) => {
            setJustSaved(false);
            setDraft((d) => (d === null ? d : fn(d)));
        },
        discard: () => {
            setDraft(saved);
        },
        dirty,
        save,
        busy,
        error,
        justSaved,
        load: useLoad([remote], false),
    };
}

// The clipboard and leaving the page are platform seams: web uses the browser, mobile the share sheet.
interface PageLinks {
    copy?: (text: string) => void;
    open?: (url: string) => void;
    share?: (url: string) => void;
}

function useCopied(write?: (text: string) => void): {
    copied: string | null;
    copy: (key: string, text: string) => void;
} {
    const [copied, setCopied] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    return {
        copied,
        copy: (key, text) => {
            write?.(text);
            setCopied(key);
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                setCopied(null);
            }, 1800);
        },
    };
}

/** Everything on the Online booking page: link, embed, what and who is bookable, and the rules. */
export function useOnlineBookingSettings(api: ApiLike, bookBase: string, links: PageLinks = {}) {
    const d = useOnlineDraft(api);
    const { copied, copy } = useCopied(links.copy);
    const out = d.remote.data;
    const link = out ? bookingPageUrl(bookBase, out.slug) : "";
    const base = bookBase.replace(/\/+$/, "");
    const embed = out
        ? `<iframe src="${link}?embed=1" title="Book with ${out.business_name}" style="width:100%;border:0" loading="lazy"></iframe>\n<script src="${base}/embed.js" async></script>`
        : "";
    const services = (out?.services ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        meta: [
            x.duration_min !== null ? s.minutes(x.duration_min) : null,
            formatMoney(x.price_cents),
        ]
            .filter(Boolean)
            .join(" · "),
        color: x.color,
        deposit: x.deposit_cents > 0 ? s.deposit(formatMoney(x.deposit_cents)) : s.noDeposit,
        bookable: d.draft?.services[x.id] === true,
        priceLabel: formatMoney(x.price_cents),
    }));
    const staff = (out?.staff ?? []).map((x) => {
        const name = x.name ?? x.title ?? "";
        return {
            id: x.id,
            name,
            title: x.title ?? "",
            color: x.color,
            initials: initials(name),
            online: d.draft?.staff[x.id] === true,
        };
    });
    const bookable = services.filter((x) => x.bookable);
    const setPolicy = <K extends keyof BookingPolicy>(k: K, v: BookingPolicy[K]): void => {
        d.setDraft((x) => ({ ...x, policy: { ...x.policy, [k]: v } }));
    };
    return {
        load: d.load,
        ready: d.draft !== null,
        policy: d.draft?.policy ?? null,
        setPolicy,
        link,
        linkLabel: link.replace(/^https?:\/\//, ""),
        openPage: () => {
            links.open?.(link);
        },
        sharePage: () => {
            links.share?.(link);
        },
        embed,
        copied,
        copy,
        services,
        toggleService: (id: string) => {
            d.setDraft((x) => ({
                ...x,
                services: { ...x.services, [id]: x.services[id] !== true },
            }));
        },
        staff,
        toggleStaff: (id: string) => {
            d.setDraft((x) => ({ ...x, staff: { ...x.staff, [id]: x.staff[id] !== true } }));
        },
        bookableCount: bookable.length,
        leadOptions: Object.entries(s.leadOptions).map(([k, label]) => ({ key: k, label })),
        advanceOptions: Object.entries(s.advanceOptions).map(([k, label]) => ({ key: k, label })),
        stepOptions: Object.entries(s.stepOptions).map(([k, label]) => ({ key: k, label })),
        stats: out
            ? [
                  { label: s.bookings, value: String(out.online_30d) },
                  { label: s.deposits, value: formatMoney(out.deposits_30d_cents) },
              ]
            : [],
        previewServices: bookable.slice(0, 6),
        previewMore: Math.max(0, bookable.length - 6),
        businessName: out?.business_name ?? "",
        dirty: d.dirty,
        discard: d.discard,
        save: () => {
            d.save(["policy", "services", "staff"], s.saveError);
        },
        busy: d.busy,
        error: d.error,
        justSaved: d.justSaved,
    };
}

export type OnlineBookingSettings = ReturnType<typeof useOnlineBookingSettings>;

const CUTOFFS = [0, 2, 12, 24, 48, 72];

/** The cancellation policy, the sentence clients read, and three worked examples. */
export function useBookingPolicy(api: ApiLike) {
    const d = useOnlineDraft(api);
    const draft = d.draft?.policy ?? null;
    const now = new Date();
    const set = <K extends keyof BookingPolicy>(k: K, v: BookingPolicy[K]): void => {
        d.setDraft((x) => ({ ...x, policy: { ...x.policy, [k]: v } }));
    };
    const cancel = draft?.cancel_cutoff_hours ?? 24;
    const move = draft?.reschedule_cutoff_hours ?? 24;
    const ahead = Math.max(3, Math.ceil(cancel / 24) + 1);
    const visitDay = addDays(now, ahead);
    const examples: { key: string; intent: Intent; text: string }[] = [
        {
            key: "early",
            intent: "success",
            text: p.exampleCancelEarly(formatWeekday(now), formatWeekday(visitDay)),
        },
        { key: "late", intent: "danger", text: p.exampleCancelLate(Math.max(1, cancel - 3)) },
        { key: "move", intent: "accent", text: p.exampleMove(move + 6) },
    ];
    return {
        load: d.load,
        policy: draft,
        set,
        cutoffOptions: CUTOFFS.map((h) => ({ key: String(h), label: p.hoursBefore(h) })),
        maxMoveOptions: Object.entries(p.maxMovesOptions).map(([k, label]) => ({ key: k, label })),
        clientText:
            draft === null
                ? ""
                : draft.self_service
                  ? p.clientText(
                        p.hoursBefore(cancel),
                        p.hoursBefore(move),
                        draft.late_cancel_deposit === "keep",
                    )
                  : p.clientTextOff,
        examples: examples.filter(
            (x) =>
                (draft?.self_service !== false || x.key !== "move") &&
                (x.key !== "late" || cancel > 0),
        ),
        lateLabel: relativeDayTime(new Date(now.getTime() + Math.max(1, cancel - 3) * 3_600_000)),
        dirty: d.dirty,
        save: () => {
            d.save(["policy"], p.saveError);
        },
        busy: d.busy,
        error: d.error,
        justSaved: d.justSaved,
    };
}

interface ProductRow {
    id: string;
    name: string;
    price_cents: number | null;
    color: string | null;
    image_file_id: string | null;
    track_stock: number;
    stock_on_hand: number | null;
    addon: number;
    addon_for: string | null;
    attached: number;
}

interface ServiceRow {
    id: string;
    name: string;
}

export const ADDON_PRODUCTS_SQL = `
SELECT i.id, i.name, i.price_cents, i.color, i.track_stock, i.stock_on_hand,
       (SELECT f.id FROM files f
        WHERE f.parent_type = 'item' AND f.parent_id = i.id AND f.purpose = 'image'
        ORDER BY f.created_at DESC LIMIT 1) AS image_file_id,
       i.addon, i.addon_for,
       (SELECT COUNT(DISTINCT a.booking_id) FROM addons a JOIN bookings b ON b.id = a.booking_id
          WHERE a.item_id = i.id AND b.source = 'online' AND b.created_at > ?) AS attached
FROM items i WHERE i.kind = 'product' AND i.active = 1 ORDER BY i.name COLLATE NOCASE`;

export const ONLINE_BOOKINGS_SQL =
    "SELECT COUNT(*) AS n FROM bookings WHERE source = 'online' AND created_at > ?";

export const ADDON_SERVICES_SQL =
    "SELECT id, name FROM items WHERE kind IN ('service', 'class') AND active = 1 ORDER BY name COLLATE NOCASE";

function parseIds(raw: string | null): string[] {
    if (raw === null || raw === "") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((x): x is string => typeof x === "string")
            : [];
    } catch {
        return raw
            .replace(/[{}]/g, "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
    }
}

interface AddonOffer {
    id: string;
    name: string;
    color: string | null;
    imageFileId: string | null;
    addon: boolean;
    addonFor: string[];
    price: string;
    stockLabel: string | null;
    soldOut: boolean;
    attachLabel: string;
    scopeLabel: string;
}

/** Which products clients can add while booking, with which services, and how often they're added. */
export function useAddonOffers(api: ApiLike) {
    const since = addDays(new Date(), -30).toISOString();
    const products = useQuery<ProductRow>(ADDON_PRODUCTS_SQL, [since]);
    const onlineQ = useQuery<{ n: number }>(ONLINE_BOOKINGS_SQL, [since]);
    const services = useQuery<ServiceRow>(ADDON_SERVICES_SQL).data;
    const [edits, setEdits] = useState<Record<string, { addon: boolean; addonFor: string[] }>>({});
    const [openId, setOpenId] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);
    const { busy, error, run } = useAsyncAction();
    const online = onlineQ.data[0]?.n ?? 0;
    const offers: AddonOffer[] = products.data.map((r) => {
        const base = { addon: r.addon === 1, addonFor: parseIds(r.addon_for) };
        const cur = edits[r.id] ?? base;
        const rate = online > 0 ? Math.round((r.attached / online) * 100) : 0;
        const left = r.track_stock === 1 ? Math.max(0, r.stock_on_hand ?? 0) : null;
        return {
            id: r.id,
            name: r.name,
            color: r.color,
            imageFileId: r.image_file_id,
            addon: cur.addon,
            addonFor: cur.addonFor,
            price: formatMoney(r.price_cents ?? 0),
            stockLabel: left === null ? null : left > 0 ? a.stock(left) : a.noStock,
            soldOut: left === 0,
            attachLabel: a.attach(rate),
            scopeLabel: cur.addonFor.length === 0 ? a.withEvery : a.withSome(cur.addonFor.length),
        };
    });
    const revenue = products.data.reduce((sum, r) => sum + r.attached * (r.price_cents ?? 0), 0);
    const edit = (id: string, patch: Partial<{ addon: boolean; addonFor: string[] }>): void => {
        const o = offers.find((x) => x.id === id);
        if (!o) return;
        setJustSaved(false);
        setEdits((e) => ({ ...e, [id]: { addon: o.addon, addonFor: o.addonFor, ...patch } }));
    };
    const load = useReplicaLoad([products, onlineQ], products.data.length === 0);
    return {
        load: load,
        offers,
        offered: offers.filter((x) => x.addon),
        notOffered: offers.filter((x) => !x.addon),
        services: services.map((x) => ({ key: x.id, label: x.name })),
        openId,
        setOpenId,
        toggle: (id: string) => {
            const o = offers.find((x) => x.id === id);
            if (o) edit(id, { addon: !o.addon });
        },
        toggleService: (id: string, serviceId: string) => {
            const o = offers.find((x) => x.id === id);
            if (!o) return;
            edit(id, {
                addonFor: o.addonFor.includes(serviceId)
                    ? o.addonFor.filter((x) => x !== serviceId)
                    : [...o.addonFor, serviceId],
            });
        },
        everyService: (id: string) => {
            edit(id, { addonFor: [] });
        },
        revenue: formatMoney(revenue),
        dirty: Object.keys(edits).length > 0,
        save: () => {
            const changed = Object.entries(edits).map(([id, v]) => ({
                id,
                addon: v.addon,
                addon_for: v.addonFor,
            }));
            if (changed.length === 0) return;
            run(() => api.patch("/v1/online-booking/addons", { offers: changed }), {
                onSuccess: () => {
                    setEdits({});
                    setJustSaved(true);
                },
                errorMessage: a.saveError,
            });
        },
        busy,
        error,
        justSaved,
    };
}
