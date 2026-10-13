import { type PlanInterval, type PlanView, strings, usePlan } from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Choice,
    KeyValueList,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const p = strings.plans;

function leave(url: string): void {
    window.location.assign(url);
}

function Tiers({ plan }: { plan: PlanView }) {
    return (
        <div className="space-y-4">
            <Choice<PlanInterval>
                layout="segmented"
                label={p.interval}
                value={plan.interval}
                onChange={plan.setInterval}
                options={plan.intervals}
            />
            <div className="grid gap-4 md:grid-cols-2">
                {plan.tiers.map((tier) => (
                    <Panel key={tier.plan} title={tier.name}>
                        <div className="space-y-3">
                            <p className="text-sm text-ink-soft">{tier.summary}</p>
                            <p className="font-display text-2xl font-bold text-ink">{tier.price}</p>
                            <p className="text-sm text-muted">{tier.staff}</p>
                            {tier.current ? (
                                <Badge label={p.current} intent="success" />
                            ) : tier.action === null ? null : (
                                <Button
                                    variant={tier.plan === "premium" ? "outline" : "primary"}
                                    busy={plan.busy}
                                    onPress={() => {
                                        plan.choose(tier.plan);
                                    }}
                                >
                                    {tier.action}
                                </Button>
                            )}
                        </div>
                    </Panel>
                ))}
            </div>
            <p className="text-xs text-muted">{plan.taxNote}</p>
        </div>
    );
}

export function Plans() {
    const plan = usePlan(api, leave);
    return (
        <div>
            <p className="mt-1 text-sm text-muted">{p.subtitle}</p>
            <div className="mt-6 space-y-6">
                {plan.phase === "loading" ? (
                    <Panel flush>
                        <Skeleton variant="line" count={3} label={p.loading} />
                    </Panel>
                ) : plan.phase === "error" ? (
                    <Panel flush>
                        <LoadFailed
                            message={p.loadError}
                            retrying={plan.refreshing}
                            onRetry={plan.refresh}
                        />
                    </Panel>
                ) : (
                    <>
                        <Panel>
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <h3 className="font-display text-lg font-bold text-ink">
                                        {plan.title}
                                    </h3>
                                    <StatusPill status={plan.status} intent={plan.intent} />
                                </div>
                                <p className="max-w-xl text-sm text-ink-soft">{plan.detail}</p>
                                <KeyValueList rows={plan.facts} />
                                {plan.managed ? (
                                    <Button
                                        variant="outline"
                                        icon="card"
                                        busy={plan.busy}
                                        onPress={plan.manage}
                                    >
                                        {p.manage}
                                    </Button>
                                ) : null}
                            </div>
                        </Panel>
                        {plan.error !== null ? (
                            <Notice tone="danger" banner>
                                {plan.error}
                            </Notice>
                        ) : null}
                        <Tiers plan={plan} />
                    </>
                )}
            </div>
        </div>
    );
}
