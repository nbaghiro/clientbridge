import { strings, useResourceForm, useResourceSettings } from "@clientbridge/app-core";
import { Button, Empty, ListRow, Notice, PageHeader, Panel, TextField } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { Loaded } from "../components/Loaded";

const s = strings.resources;

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
                <Panel flush>
                    {editing === "new" ? (
                        <ResourceEditor resource={null} onDone={done} onCancel={cancel} />
                    ) : null}
                    {r.entries.length === 0 && editing !== "new" ? (
                        <Empty icon="door" message={s.empty} body={s.emptyHint} variant="inline" />
                    ) : null}
                    {r.entries.map((e) =>
                        editing === e.id ? (
                            <ResourceEditor
                                key={e.id}
                                resource={e}
                                onDone={done}
                                onCancel={cancel}
                            />
                        ) : (
                            <ListRow
                                key={e.id}
                                icon="door"
                                title={e.name}
                                detail={e.detail}
                                intent={e.intent}
                                trailing={
                                    <div className="flex gap-2">
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
                                }
                            />
                        ),
                    )}
                </Panel>
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
            className="flex items-end gap-3 border-b border-line-soft p-4"
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
