import { type PlanInterval, type PlanView, strings, usePlan } from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Choice,
    KeyValueList,
    LoadFailed,
    Notice,
    PageHeader,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { leave } from "../lib/powersync";

const p = strings.plans;

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
                            <div>
                                {tier.anchor !== null ? (
                                    <s
                                        aria-label={tier.anchorLabel ?? undefined}
                                        className="block text-sm tabular-nums text-muted"
                                    >
                                        {tier.anchor}
                                    </s>
                                ) : null}
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <p className="font-display text-2xl font-bold tabular-nums text-ink">
                                        {tier.price}
                                    </p>
                                    {tier.saving !== null ? (
                                        <Badge label={tier.saving} intent="success" />
                                    ) : null}
                                </div>
                            </div>
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
        <div className="space-y-6">
            <PageHeader title={strings.navigation.setupSections.plan} subtitle={p.subtitle} />
            <div className="space-y-6">
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
                        <Panel
                            title={plan.title}
                            actions={<StatusPill status={plan.status} intent={plan.intent} />}
                        >
                            <div className="space-y-3">
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
