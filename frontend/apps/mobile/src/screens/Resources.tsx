import { strings, useResourceForm, useResourceSettings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    SheetHeader,
    Skeleton,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.resources;

/** The rooms and equipment services book: what each one is used by, and its record in a sheet. */
export function ResourcesScreen() {
    const r = useResourceSettings(api);
    const openLink = useOpenLink();
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = r.entries.find((e) => e.id === openId) ?? null;
    const add = (): void => {
        setAdding(true);
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
            ) : r.load.state === "empty" ? (
                <Empty
                    icon="door"
                    message={s.empty}
                    body={s.emptyHint}
                    variant="card"
                    actions={
                        <Button size="sm" icon="plus" onPress={add}>
                            {s.add}
                        </Button>
                    }
                />
            ) : (
                <>
                    <View style={styles.head}>
                        <Text style={[styles.muted, styles.flex]}>{r.summary ?? ""}</Text>
                        <Button size="sm" icon="plus" onPress={add}>
                            {s.addShort}
                        </Button>
                    </View>
                    <Panel flush>
                        {r.entries.map((e) => (
                            <ListRow
                                key={e.id}
                                title={e.name}
                                detail={e.usedByLine}
                                meta={
                                    e.active ? (
                                        <Text style={styles.small}>{e.upcoming}</Text>
                                    ) : (
                                        <StatusPill status={e.status} intent={e.intent} />
                                    )
                                }
                                trailing={<Icon name="chevronRight" size={18} color={c.muted} />}
                                onPress={() => {
                                    setOpenId(e.id);
                                }}
                            />
                        ))}
                    </Panel>
                </>
            )}

            {adding ? (
                <Modal
                    open
                    onClose={() => {
                        setAdding(false);
                    }}
                    size="lg"
                >
                    <SheetHeader
                        title={s.newTitle}
                        onClose={() => {
                            setAdding(false);
                        }}
                    />
                    <Text style={[styles.muted, styles.gap]}>{s.emptyHint}</Text>
                    <ResourceForm
                        resource={null}
                        onDone={() => {
                            setAdding(false);
                            r.refresh();
                        }}
                    />
                </Modal>
            ) : null}

            {open !== null ? (
                <Modal
                    open
                    onClose={() => {
                        setOpenId(null);
                    }}
                    size="xl"
                >
                    <SheetHeader
                        title={open.name}
                        subtitle={open.upcoming}
                        onClose={() => {
                            setOpenId(null);
                        }}
                        closeLabel={strings.common.close}
                    />
                    <View style={styles.sheet}>
                        <View style={styles.statusRow}>
                            <StatusPill status={open.status} intent={open.intent} />
                        </View>
                        {open.active ? null : <Notice tone="info">{open.detail}</Notice>}
                        {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                        <ResourceForm key={open.id} resource={open} onDone={r.refresh} />
                        <Text style={styles.section}>{s.servicesTitle}</Text>
                        {open.usedBy.length === 0 ? (
                            <Text style={styles.muted}>{s.usedByNone}</Text>
                        ) : (
                            <Panel flush>
                                {open.usedBy.map((name) => (
                                    <ListRow key={name} title={name} density="compact" />
                                ))}
                            </Panel>
                        )}
                        <Text style={styles.small}>{s.servicesHint}</Text>
                        <View style={styles.actions}>
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    setOpenId(null);
                                    openLink("catalog");
                                }}
                            >
                                {s.openServices}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                busy={r.toggling === open.id}
                                onPress={() => {
                                    r.toggle(open.id);
                                }}
                            >
                                {open.toggleLabel}
                            </Button>
                        </View>
                    </View>
                </Modal>
            ) : null}
        </ScrollView>
    );
}

function ResourceForm({
    resource,
    onDone,
}: {
    resource: { id: string; name: string } | null;
    onDone: () => void;
}) {
    const f = useResourceForm(api, resource, onDone);
    return (
        <View style={styles.form}>
            <TextField
                label={s.name}
                value={f.name}
                onChange={f.setName}
                onSubmit={f.submit}
                placeholder={s.namePlaceholder}
                error={f.error}
                surface="surface"
            />
            <Button busy={f.busy} onPress={f.submit}>
                {s.save}
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    flex: { flex: 1, minWidth: 0 },
    sheet: { gap: 12 },
    statusRow: { flexDirection: "row" },
    form: { gap: 10 },
    gap: { marginBottom: 12 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    section: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
        marginTop: 8,
    },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    small: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12 },
});
