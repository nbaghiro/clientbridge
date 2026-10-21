import { strings, useSetupChecklist } from "@clientbridge/app-core";
import { Button, Checklist, Empty, Notice, PageHeader, Panel } from "@clientbridge/ui";

import { config } from "../config";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";
import { Loaded } from "./Loaded";

const o = strings.business.getSetUp;

/** The Setup home: what is left before bookings and payouts, each step linking to where it's done. */
export function GetSetUp() {
    const list = useSetupChecklist(api, config.bookUrl);
    const open = useOpenLink();
    const pct = Math.round((list.done / list.total) * 100);

    return (
        <div className="max-w-3xl space-y-6">
            <PageHeader
                title={strings.navigation.setupSections.start}
                subtitle={o.body}
                actions={
                    list.load.ready && !list.dismissed ? (
                        <Button
                            variant="quiet"
                            size="sm"
                            onPress={() => {
                                list.setHidden(true);
                            }}
                        >
                            {o.hide}
                        </Button>
                    ) : undefined
                }
            />
            {list.hideError !== null ? <Notice tone="danger">{list.hideError}</Notice> : null}
            <Loaded load={list.load} loading={o.loading} failed={o.loadError} rows={7}>
                {list.dismissed ? (
                    <Panel flush>
                        <Empty
                            icon="checkCircle"
                            message={o.hiddenTitle}
                            body={o.hiddenBody(list.total - list.done)}
                            actions={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onPress={() => {
                                        list.setHidden(false);
                                    }}
                                >
                                    {o.showList}
                                </Button>
                            }
                        />
                    </Panel>
                ) : (
                    <Panel
                        flush
                        title={o.title}
                        actions={
                            <span className="text-sm font-medium text-ink-soft">
                                {o.progress(list.done, list.total)}
                            </span>
                        }
                    >
                        <div
                            className="h-1.5 overflow-hidden bg-surface2"
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={o.progress(list.done, list.total)}
                        >
                            <div
                                className="h-full bg-accent transition-all"
                                style={{ width: `${String(pct)}%` }}
                            />
                        </div>
                        <div className="px-4">
                            <Checklist
                                label={o.title}
                                items={list.steps.map((t) => ({
                                    key: t.key,
                                    label: t.label,
                                    hint: t.hint,
                                    done: t.done,
                                    action: {
                                        label: t.action,
                                        onPress: () => {
                                            open(t.target);
                                        },
                                    },
                                }))}
                            />
                        </div>
                    </Panel>
                )}
            </Loaded>
        </div>
    );
}
