import {
    createPublicOrderClient,
    money,
    strings,
    usePublicOrder,
} from "@clientbridge/app-core/public";
import { Button, Icon, LineItem, Modal, Notice, ProgressSteps, Toggle } from "@clientbridge/ui";
import { useParams } from "react-router-dom";

import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";

const client = createPublicOrderClient(config.apiUrl);
const s = strings.publicOrder;

export function PublicOrder() {
    const { token = "" } = useParams<{ token: string }>();
    const flow = usePublicOrder(client, token);
    const order = flow.order;
    if (flow.status === "loading" && order === null) return <PublicStatus kind="loading" />;
    if (flow.status === "not-found") return <PublicStatus kind="notFound" />;
    if (order === null) return <PublicStatus kind="error" />;
    return (
        <PublicPage
            name={order.business_name}
            brand={order.brand}
            hero={
                <div className="max-w-2xl pt-2">
                    <p className="text-sm text-muted">
                        <span>{s.title}</span>
                        {order.number !== null ? ` · S-${String(order.number)}` : ""}
                        <span className="ml-3">
                            {new Date(order.created_at).toLocaleDateString()}
                        </span>
                    </p>
                    <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]">
                        {flow.title}
                    </h1>
                    <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-soft">
                        {s.pending}
                    </p>
                </div>
            }
        >
            <div className="space-y-5">
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
                    <ProgressSteps
                        label={s.updated}
                        steps={flow.steps}
                        layout="column"
                        className="sm:hidden"
                    />
                    <ol aria-label={s.updated} className="hidden grid-cols-4 sm:grid">
                        {flow.steps.map((step, index) => (
                            <li
                                key={step.key}
                                aria-current={step.state === "current" ? "step" : undefined}
                                className="relative pr-4"
                            >
                                <div className="flex items-center">
                                    <span
                                        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${step.state === "todo" ? "border-2 border-line bg-surface text-muted" : "bg-accent text-accent-ink ring-4 ring-accent-weak"}`}
                                    >
                                        {step.state === "done" ? (
                                            <Icon name="check" size={15} />
                                        ) : (
                                            index + 1
                                        )}
                                    </span>
                                    {index < 3 ? (
                                        <span
                                            className={`mx-2 h-0.5 flex-1 ${step.state === "done" ? "bg-accent" : "bg-line"}`}
                                        />
                                    ) : null}
                                </div>
                                <p className="mt-3 text-sm font-semibold">{step.label}</p>
                                <p className="mt-1 text-xs text-muted">
                                    {flow.dates[index]
                                        ? new Date(flow.dates[index] ?? "").toLocaleString()
                                        : "—"}
                                </p>
                            </li>
                        ))}
                    </ol>
                </section>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-5">
                        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
                            <h2 className="mb-4 font-display text-lg font-bold">{s.pickup}</h2>
                            <div className="grid gap-5 sm:grid-cols-2">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-muted">
                                        {s.pickupTime}
                                    </p>
                                    <p className="mt-1 font-semibold">
                                        {order.pickup_from
                                            ? new Date(order.pickup_from).toLocaleString()
                                            : strings.publicShop.pickupAsap}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-muted">
                                        {s.pickupWhere}
                                    </p>
                                    <p className="mt-1 font-semibold">{order.business_name}</p>
                                    {order.address ? (
                                        <p className="mt-1 text-sm text-muted">{order.address}</p>
                                    ) : null}
                                </div>
                            </div>
                        </section>
                        <section className="rounded-2xl border border-line bg-surface p-5">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="font-display text-lg font-bold">{s.items}</h2>
                                {order.receipt_token ? (
                                    <Button
                                        size="sm"
                                        variant="link"
                                        icon="receipt"
                                        onPress={() => {
                                            window.location.assign(
                                                `/r/${encodeURIComponent(order.receipt_token ?? "")}`,
                                            );
                                        }}
                                    >
                                        {s.receipt}
                                    </Button>
                                ) : null}
                            </div>
                            {order.lines.map((line, index) => (
                                <LineItem
                                    key={index}
                                    title={line.description}
                                    meta={String(line.quantity)}
                                    cents={line.amount_cents}
                                />
                            ))}
                            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
                                <div className="flex justify-between">
                                    <dt>{s.subtotal}</dt>
                                    <dd>{money(order.subtotal_cents, order.currency)}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt>{s.tax}</dt>
                                    <dd>{money(order.tax_total_cents, order.currency)}</dd>
                                </div>
                                <div className="flex justify-between font-bold">
                                    <dt>{s.total}</dt>
                                    <dd>{money(order.total_cents, order.currency)}</dd>
                                </div>
                            </dl>
                        </section>
                    </div>
                    <aside className="space-y-5 self-start">
                        <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <h2 className="font-display text-lg font-bold">{s.alertTitle}</h2>
                            <Toggle
                                label={s.alerts}
                                value={order.notify_sms}
                                onChange={flow.setAlerts}
                                disabled={flow.busy}
                            />
                        </section>
                        <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <h2 className="font-display text-lg font-bold">{s.contact}</h2>
                            <p className="text-sm text-muted">{s.contactBody}</p>
                            {order.phone ? (
                                <Button
                                    variant="outline"
                                    full
                                    icon="phone"
                                    onPress={() => {
                                        window.location.href = `tel:${order.phone ?? ""}`;
                                    }}
                                >
                                    {order.phone}
                                </Button>
                            ) : null}
                            {flow.error ? <Notice tone="danger">{flow.error}</Notice> : null}
                            {order.can_cancel ? (
                                <Button
                                    variant="quiet"
                                    full
                                    onPress={() => {
                                        flow.setConfirmCancel(true);
                                    }}
                                >
                                    {s.cancel}
                                </Button>
                            ) : null}
                            <Button variant="outline" full onPress={flow.retry}>
                                {s.refresh}
                            </Button>
                            {order.receipt_token ? (
                                <Button
                                    full
                                    onPress={() => {
                                        window.location.assign(
                                            `/r/${encodeURIComponent(order.receipt_token ?? "")}`,
                                        );
                                    }}
                                >
                                    {s.receipt}
                                </Button>
                            ) : null}
                        </section>
                    </aside>
                </div>
            </div>
            <Modal
                open={flow.confirmCancel}
                onClose={() => {
                    if (!flow.busy) flow.setConfirmCancel(false);
                }}
            >
                <h2 className="font-display text-xl font-bold">{s.cancelTitle}</h2>
                <p className="my-4 text-sm text-muted">{s.cancelBody}</p>
                {flow.error ? <Notice tone="danger">{flow.error}</Notice> : null}
                <div className="mt-4 flex gap-3">
                    <Button
                        variant="outline"
                        onPress={() => {
                            flow.setConfirmCancel(false);
                        }}
                        disabled={flow.busy}
                    >
                        {s.keep}
                    </Button>
                    <Button variant="danger" busy={flow.busy} onPress={flow.cancel}>
                        {s.cancel}
                    </Button>
                </div>
            </Modal>
        </PublicPage>
    );
}
