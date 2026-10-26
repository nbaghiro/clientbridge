import { strings, useResourceForm, useResourceSettings } from "@clientbridge/app-core";
import {
    Button,
    ListPage,
    Notice,
    PageHeader,
    Panel,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { Loaded } from "../components/Loaded";

const s = strings.resources;
const GRID =
    "grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_11rem] items-center gap-4";

/** The rooms and equipment services book: add, rename, and turn one off without losing its visits. */
export function Resources() {
    const r = useResourceSettings(api);
    const [editing, setEditing] = useState<string | null>(null);
    const done = () => {
        setEditing(null);
        r.refresh();
    };
    const cancel = () => {
        setEditing(null);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title={strings.navigation.setupSections.resources}
                subtitle={s.subtitle}
                actions={
                    <Button
                        icon="plus"
                        onPress={() => {
                            setEditing("new");
                        }}
                    >
                        {s.add}
                    </Button>
                }
            />
            <Loaded load={r.load} loading={s.loading} failed={s.loadError} rows={3}>
                {editing === "new" ? (
                    <Panel flush>
                        <ResourceEditor resource={null} onDone={done} onCancel={cancel} />
                    </Panel>
                ) : null}
                <ListPage
                    head={
                        r.entries.length === 0 ? undefined : (
                            <div className={GRID}>
                                <span>{s.name}</span>
                                <span>{s.colUpcoming}</span>
                                <span>{s.colStatus}</span>
                                <span />
                            </div>
                        )
                    }
                    rows={r.entries}
                    rowKey={(e) => e.id}
                    empty={{ message: s.empty, body: s.emptyHint, icon: "door" }}
                    renderRow={(e) =>
                        editing === e.id ? (
                            <ResourceEditor resource={e} onDone={done} onCancel={cancel} />
                        ) : (
                            <div className={GRID}>
                                <span className="truncate font-medium text-ink">{e.name}</span>
                                <span className="truncate text-sm text-ink-soft">{e.upcoming}</span>
                                <span>
                                    <StatusPill status={e.status} intent={e.intent} />
                                </span>
                                <div className="flex justify-end gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => {
                                            setEditing(e.id);
                                        }}
                                    >
                                        {s.rename}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        busy={r.toggling === e.id}
                                        onPress={() => {
                                            r.toggle(e.id);
                                        }}
                                    >
                                        {e.toggleLabel}
                                    </Button>
                                </div>
                            </div>
                        )
                    }
                />
                {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
            </Loaded>
        </div>
    );
}

function ResourceEditor({
    resource,
    onDone,
    onCancel,
}: {
    resource: { id: string; name: string } | null;
    onDone: () => void;
    onCancel: () => void;
}) {
    const f = useResourceForm(api, resource, onDone);
    return (
        <form
            className="flex items-end gap-3 p-4"
            onSubmit={(e) => {
                e.preventDefault();
                f.submit();
            }}
        >
            <div className="min-w-0 flex-1">
                <TextField
                    label={s.name}
                    value={f.name}
                    onChange={f.setName}
                    placeholder={s.namePlaceholder}
                    error={f.error}
                />
            </div>
            <Button submit busy={f.busy}>
                {s.save}
            </Button>
            <Button variant="quiet" onPress={onCancel}>
                {strings.common.cancel}
            </Button>
        </form>
    );
}
