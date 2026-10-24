import { strings, useResourceForm, useResourceSettings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Empty, ListRow, LoadFailed, Notice, Skeleton, TextField } from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.resources;

/** The rooms and equipment services book: add, rename, and turn one off without losing its visits. */
export function ResourcesScreen() {
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
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Text style={styles.muted}>{s.subtitle}</Text>
            {r.load.state === "loading" ? (
                <Skeleton variant="row" count={3} label={s.loading} />
            ) : r.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={r.load.retry}
                    retrying={r.load.retrying}
                />
            ) : (
                <>
                    {editing === "new" ? (
                        <ResourceEditor resource={null} onDone={done} onCancel={cancel} />
                    ) : (
                        <Button
                            icon="plus"
                            onPress={() => {
                                setEditing("new");
                            }}
                        >
                            {s.add}
                        </Button>
                    )}
                    {r.entries.length === 0 && editing !== "new" ? (
                        <Empty icon="door" message={s.empty} body={s.emptyHint} variant="card" />
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
                            <View key={e.id} style={styles.card}>
                                <ListRow
                                    icon="door"
                                    title={e.name}
                                    detail={e.detail}
                                    intent={e.intent}
                                />
                                <View style={styles.actions}>
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
                                </View>
                            </View>
                        ),
                    )}
                    {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                </>
            )}
        </ScrollView>
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
        <View style={styles.card}>
            <TextField
                label={s.name}
                value={f.name}
                onChange={f.setName}
                onSubmit={f.submit}
                placeholder={s.namePlaceholder}
                error={f.error}
            />
            <View style={styles.actions}>
                <Button busy={f.busy} onPress={f.submit}>
                    {s.save}
                </Button>
                <Button variant="quiet" onPress={onCancel}>
                    {strings.common.cancel}
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 12,
        gap: 8,
    },
    actions: { flexDirection: "row", gap: 8 },
    muted: { color: c.muted, fontSize: 13 },
});
