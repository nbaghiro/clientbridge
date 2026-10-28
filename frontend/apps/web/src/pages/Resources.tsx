import { strings, useResourceForm, useResourceSettings } from "@clientbridge/app-core";
import {
    Button,
    DetailSection,
    Icon,
    ListPage,
    Modal,
    Notice,
    PageHeader,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";

import { DeskPanel } from "../components/Desk";
import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.resources;
const GRID =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)_minmax(0,1fr)_8rem_16px] items-center gap-4";

/** The rooms and equipment services book: what each one is used by, and its record from the right. */
export function Resources() {
    const r = useResourceSettings(api);
    const openLink = useOpenLink();
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = r.entries.find((e) => e.id === openId) ?? null;
    const none = r.load.state === "empty";
    const add = (): void => {
        setAdding(true);
    };

    return (
        <div className="space-y-6">
            <PageHeader title={strings.navigation.setupSections.resources} subtitle={s.subtitle} />
            <Loaded load={r.load} loading={s.loading} failed={s.loadError} rows={3}>
                <div className="space-y-4">
                    {none ? null : (
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm text-muted">{r.summary}</p>
                            <Button size="sm" icon="plus" onPress={add}>
                                {s.add}
                            </Button>
                        </div>
                    )}
                    <ListPage
                        head={
                            none ? undefined : (
                                <div className={GRID}>
                                    <span>{s.name}</span>
                                    <span>{s.colUsedBy}</span>
                                    <span>{s.colUpcoming}</span>
                                    <span>{s.colStatus}</span>
                                    <span />
                                </div>
                            )
                        }
                        rows={r.entries}
                        rowKey={(e) => e.id}
                        selectedKey={openId ?? undefined}
                        onRowPress={(e) => {
                            setOpenId(e.id);
                        }}
                        empty={{
                            message: s.empty,
                            body: s.emptyHint,
                            icon: "door",
                            actions: (
                                <Button size="sm" icon="plus" onPress={add}>
                                    {s.add}
                                </Button>
                            ),
                        }}
                        renderRow={(e) => (
                            <div className={GRID}>
                                <span className="truncate font-medium text-ink">{e.name}</span>
                                <span
                                    className={`truncate text-sm ${e.usedBy.length === 0 ? "text-muted" : "text-ink-soft"}`}
                                >
                                    {e.usedByLine}
                                </span>
                                <span className="truncate text-sm text-ink-soft">{e.upcoming}</span>
                                <span>
                                    <StatusPill status={e.status} intent={e.intent} />
                                </span>
                                <Icon name="chevronRight" size={16} className="text-muted" />
                            </div>
                        )}
                    />
                </div>
            </Loaded>

            {adding ? (
                <Modal
                    size="md"
                    onClose={() => {
                        setAdding(false);
                    }}
                >
                    <h2 className="font-display text-lg font-bold text-ink">{s.newTitle}</h2>
                    <p className="mt-1 text-sm text-muted">{s.emptyHint}</p>
                    <div className="mt-5">
                        <ResourceForm
                            resource={null}
                            onDone={() => {
                                setAdding(false);
                                r.refresh();
                            }}
                            onCancel={() => {
                                setAdding(false);
                            }}
                        />
                    </div>
                </Modal>
            ) : null}

            {open !== null ? (
                <DeskPanel
                    title={open.name}
                    subtitle={open.upcoming}
                    status={{ status: open.status, intent: open.intent }}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    actions={
                        <Button
                            variant="outline"
                            busy={r.toggling === open.id}
                            onPress={() => {
                                r.toggle(open.id);
                            }}
                        >
                            {open.toggleLabel}
                        </Button>
                    }
                >
                    {open.active ? null : <Notice tone="info">{open.detail}</Notice>}
                    {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                    <ResourceForm key={open.id} resource={open} onDone={r.refresh} />
                    <DetailSection title={s.servicesTitle}>
                        {open.usedBy.length === 0 ? (
                            <p className="text-sm text-muted">{s.usedByNone}</p>
                        ) : (
                            <ul className="divide-y divide-line-soft rounded-lg border border-line">
                                {open.usedBy.map((name) => (
                                    <li key={name} className="px-4 py-2.5 text-sm text-ink">
                                        {name}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="mt-2 text-xs text-muted">{s.servicesHint}</p>
                        <div className="mt-3">
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    openLink("catalog");
                                }}
                            >
                                {s.openServices}
                            </Button>
                        </div>
                    </DetailSection>
                </DeskPanel>
            ) : null}
        </div>
    );
}

function ResourceForm({
    resource,
    onDone,
    onCancel,
}: {
    resource: { id: string; name: string } | null;
    onDone: () => void;
    onCancel?: () => void;
}) {
    const f = useResourceForm(api, resource, onDone);
    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                f.submit();
            }}
        >
            <TextField
                label={s.name}
                value={f.name}
                onChange={f.setName}
                placeholder={s.namePlaceholder}
                error={f.error}
            />
            <div className="flex justify-end gap-2">
                {onCancel !== undefined ? (
                    <Button variant="quiet" onPress={onCancel}>
                        {strings.common.cancel}
                    </Button>
                ) : null}
                <Button submit busy={f.busy}>
                    {s.save}
                </Button>
            </div>
        </form>
    );
}
