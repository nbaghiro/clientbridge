import {
    type ClientListRow,
    type ClientSelection,
    type SubjectRow,
    canManagePayments,
    strings,
    useClientEditor,
    useClientMerge,
    useNoteComposer,
    useSubjectForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    Checkbox,
    Choice,
    confirm,
    Field,
    Icon,
    Modal,
    Notice,
    TagInput,
    TextField,
    Toggle,
    DateField,
} from "@clientbridge/ui";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;
const e = strings.clients.edit;
const p = strings.clients.pets;
const h = strings.clients.history;
const t = strings.clients.tidy;

/** A sheet's top row: Cancel, the title, and the primary action. */
function SheetHeader({
    title,
    onCancel,
    action,
    onAction,
    busy = false,
    disabled = false,
}: {
    title: string;
    onCancel: () => void;
    action?: string | undefined;
    onAction?: (() => void) | undefined;
    busy?: boolean | undefined;
    disabled?: boolean | undefined;
}) {
    return (
        <View style={styles.head}>
            <View style={styles.side}>
                <Button variant="link" onPress={onCancel}>
                    {strings.common.cancel}
                </Button>
            </View>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                {title}
            </Text>
            <View style={[styles.side, styles.right]}>
                {action !== undefined ? (
                    <Button variant="link" busy={busy} disabled={disabled} onPress={onAction}>
                        {action}
                    </Button>
                ) : null}
            </View>
        </View>
    );
}

/** The one add and edit form, in a sheet; every client screen opens this. */
export function ClientEditorSheet({
    directory,
    clientId,
    onOpen,
    onClose,
}: {
    directory: readonly ClientListRow[];
    clientId: string | null;
    onOpen: (id: string) => void;
    onClose: () => void;
}) {
    const editor = useClientEditor(api, directory, clientId, (id) => {
        if (clientId === null) onOpen(id);
        else onClose();
    });
    const manager = canManagePayments(useRole());
    const { draft, set, errors } = editor;
    const dup = editor.duplicates[0];
    const askArchive = (): void => {
        if (editor.client === null) return;
        confirm({
            title: e.archiveTitle(editor.client.name),
            message: e.archiveBody,
            confirmLabel: e.archiveConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) editor.archive();
            })
            .catch(() => undefined);
    };

    return (
        <Modal open onClose={onClose} size="xl">
            <SheetHeader
                title={editor.mode === "add" ? e.addTitle : e.editTitle}
                onCancel={onClose}
                action={editor.mode === "add" ? strings.clients.addShort : e.done}
                onAction={editor.submit}
                busy={editor.busy}
                disabled={editor.mode === "edit" && !editor.dirty}
            />
            {editor.archivedNote !== null ? (
                <View style={styles.archived}>
                    <Text style={styles.archivedText}>{editor.archivedNote}</Text>
                    {manager ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={editor.restore}
                            busy={editor.busy}
                        >
                            {e.restore}
                        </Button>
                    ) : null}
                </View>
            ) : null}
            {dup !== undefined ? (
                <View accessibilityRole="alert" style={styles.dup}>
                    <View style={styles.dupHead}>
                        <Avatar name={dup.client.name} size="sm" />
                        <Text style={styles.dupTitle}>{e.duplicateTitle(dup.client.name)}</Text>
                    </View>
                    <Text style={styles.dupBody}>{e.duplicateBody(dup.reasons.join(e.and))}</Text>
                    <View style={styles.row}>
                        <Button
                            size="sm"
                            onPress={() => {
                                onOpen(dup.client.id);
                            }}
                        >
                            {e.duplicateOpen}
                        </Button>
                        <Button size="sm" variant="quiet" onPress={editor.ignoreDuplicates}>
                            {e.duplicateKeep}
                        </Button>
                    </View>
                </View>
            ) : null}
            <TextField
                label={e.nameLabel}
                required
                value={draft.name}
                onChange={(v) => {
                    set("name", v);
                }}
                placeholder={e.namePlaceholder}
                error={errors.name}
                autoComplete="name"
            />
            <TextField
                label={e.phoneLabel}
                type="tel"
                value={draft.phone}
                onChange={(v) => {
                    set("phone", v);
                }}
                placeholder={e.phonePlaceholder}
                error={errors.phone}
                autoComplete="tel"
            />
            <TextField
                label={e.emailLabel}
                type="email"
                value={draft.email}
                onChange={(v) => {
                    set("email", v);
                }}
                placeholder={e.emailPlaceholder}
                error={errors.email}
                autoComplete="email"
            />
            {errors.contact !== undefined ? <Notice tone="danger">{errors.contact}</Notice> : null}
            <Field label={e.channelLabel}>
                <Choice
                    layout="segmented"
                    label={e.channelLabel}
                    options={[
                        { key: "sms", label: e.channelText },
                        { key: "email", label: e.channelEmail },
                    ]}
                    value={draft.channel}
                    onChange={(v) => {
                        set("channel", v);
                    }}
                />
            </Field>
            <TagInput
                label={e.tagsLabel}
                tags={draft.tags}
                suggestions={editor.tagSuggestions.slice(0, 4)}
                onAdd={(tag) => {
                    set("tags", [...draft.tags, tag]);
                }}
                onRemove={(tag) => {
                    set(
                        "tags",
                        draft.tags.filter((x) => x !== tag),
                    );
                }}
                placeholder={e.tagsPlaceholder}
            />
            <View style={styles.consent}>
                <Toggle
                    label={e.consentLabel}
                    hint={editor.consentNote ?? e.consentHint}
                    value={draft.consent}
                    onChange={(v) => {
                        set("consent", v);
                    }}
                />
            </View>
            {editor.mode === "add" ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{e.petSection}</Text>
                    <Text style={styles.hint}>{e.petSectionHint}</Text>
                    <TextField
                        label={e.petName}
                        optional
                        value={draft.petName}
                        onChange={(v) => {
                            set("petName", v);
                        }}
                        placeholder={e.petNamePlaceholder}
                    />
                    <TextField
                        label={e.petBreed}
                        optional
                        value={draft.petBreed}
                        onChange={(v) => {
                            set("petBreed", v);
                        }}
                        placeholder={e.petBreedPlaceholder}
                    />
                </View>
            ) : null}
            {editor.error !== null ? (
                <Notice tone="danger" banner>
                    {editor.error}
                </Notice>
            ) : null}
            {editor.client !== null && editor.archivedNote === null && manager ? (
                <View style={styles.danger}>
                    <Button variant="danger" full onPress={askArchive}>
                        {e.archive}
                    </Button>
                    <Text style={styles.hint}>{e.dangerHint}</Text>
                </View>
            ) : null}
        </Modal>
    );
}

/** Add or edit one pet in a sheet, from the pet list or the client record. */
export function PetSheet({
    clientId,
    pet,
    onClose,
}: {
    clientId: string;
    pet: SubjectRow | null;
    onClose: () => void;
}) {
    const form = useSubjectForm(api, clientId, pet, onClose);
    const askRemove = (): void => {
        confirm({
            title: p.removeTitle(form.name),
            message: p.removeBody,
            confirmLabel: p.removeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) form.remove();
            })
            .catch(() => undefined);
    };
    return (
        <Modal open onClose={onClose} size="xl">
            <SheetHeader
                title={form.mode === "add" ? p.addPet : p.editPet}
                onCancel={onClose}
                action={p.saveShort}
                onAction={form.submit}
                busy={form.busy}
            />
            <TextField
                label={p.nameLabel}
                required
                value={form.name}
                onChange={form.setName}
                error={form.errors.name}
            />
            {form.fields.map((f) => {
                const value = form.values[f.key] ?? "";
                if (f.type === "choice")
                    return (
                        <Field key={f.key} label={f.label}>
                            <Choice
                                label={f.label}
                                options={f.options ?? []}
                                value={value === "" ? null : value}
                                onChange={(v) => {
                                    form.setValue(f.key, v === value ? "" : v);
                                }}
                            />
                        </Field>
                    );
                if (f.type === "date")
                    return (
                        <DateField
                            key={f.key}
                            label={f.label}
                            optional
                            value={value}
                            onChange={(v) => {
                                form.setValue(f.key, v);
                            }}
                            error={form.errors[f.key]}
                        />
                    );
                return (
                    <TextField
                        key={f.key}
                        label={f.unit === undefined ? f.label : `${f.label} (${f.unit})`}
                        optional
                        type={f.type === "number" ? "number" : "text"}
                        multiline={f.type === "longtext"}
                        rows={2}
                        value={value}
                        placeholder={f.placeholder}
                        onChange={(v) => {
                            form.setValue(f.key, v);
                        }}
                        error={form.errors[f.key]}
                    />
                );
            })}
            {form.error !== null ? (
                <Notice tone="danger" banner>
                    {form.error}
                </Notice>
            ) : null}
            {form.mode === "edit" ? (
                <View style={styles.danger}>
                    <Button variant="danger" full onPress={askRemove}>
                        {p.removePet}
                    </Button>
                </View>
            ) : null}
        </Modal>
    );
}

/** The note text, which pet it is about and whether it is pinned, in a sheet. */
export function NoteSheet({
    clientId,
    pets,
    onClose,
}: {
    clientId: string;
    pets: readonly SubjectRow[];
    onClose: () => void;
}) {
    const comp = useNoteComposer(api, clientId, onClose);
    return (
        <Modal open onClose={onClose} size="xl">
            <SheetHeader
                title={strings.clients.record.addNoteTitle}
                onCancel={onClose}
                action={strings.clients.addShort}
                onAction={comp.submit}
                busy={comp.busy}
                disabled={comp.body.trim() === ""}
            />
            <TextField
                multiline
                rows={3}
                name={h.notePlaceholder}
                value={comp.body}
                onChange={comp.setBody}
                placeholder={h.notePlaceholder}
                autoFocus
            />
            {pets.length > 0 ? (
                <Field label={h.about}>
                    <Choice
                        label={h.about}
                        options={[
                            { key: "client", label: h.aboutClient },
                            ...pets.map((pet) => ({ key: pet.id, label: pet.name })),
                        ]}
                        value={comp.about}
                        onChange={comp.setAbout}
                    />
                </Field>
            ) : null}
            <Toggle label={h.pin} hint={h.pinHint} value={comp.pinned} onChange={comp.setPinned} />
            {comp.error !== null ? <Notice tone="danger">{comp.error}</Notice> : null}
        </Modal>
    );
}

/** Pick the record that stays and each field's value, then merge. */
export function MergeSheet({
    a,
    b,
    onClose,
    onMerged,
}: {
    a: ClientListRow;
    b: ClientListRow;
    onClose: () => void;
    onMerged: (name: string) => void;
}) {
    const merge = useClientMerge(api, a, b, onMerged);
    const ask = (): void => {
        confirm({
            title: t.mergeTitle,
            message: t.mergeConfirmBody(merge.goneName, merge.keptName),
            confirmLabel: t.mergeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) merge.submit();
            })
            .catch(() => undefined);
    };
    return (
        <Modal open onClose={onClose} size="xl">
            <SheetHeader title={t.mergeTitle} onCancel={onClose} />
            <Text style={styles.label}>{t.whichToKeep}</Text>
            <Choice
                layout="cards"
                label={t.whichToKeep}
                options={(["a", "b"] as const).map((k) => ({
                    key: k,
                    label: merge.sides[k].client.name,
                    hint: merge.sides[k].hint,
                }))}
                value={merge.keep}
                onChange={merge.setKeep}
            />
            <Text style={styles.label}>{t.chooseValues}</Text>
            {merge.fields.map((f) => (
                <Field key={f.key} label={f.label}>
                    {f.same ? (
                        <View style={styles.row}>
                            <Text style={styles.value}>{f.a || t.none}</Text>
                            <Icon name="check" size={13} color={c.muted} />
                            <Text style={styles.hint}>{t.same}</Text>
                        </View>
                    ) : (
                        <Choice
                            label={f.label}
                            options={(["a", "b"] as const).map((k) => ({
                                key: k,
                                label: f[k] || t.none,
                                disabled: f[k] === "",
                            }))}
                            value={f.chosen}
                            onChange={(k) => {
                                merge.choose(f.key, k);
                            }}
                        />
                    )}
                </Field>
            ))}
            <Text style={styles.label}>{t.whatMoves}</Text>
            <Text style={styles.value}>
                {merge.moves.length === 0 ? t.nothingMoves : merge.moves.join(" · ")}
            </Text>
            {merge.blocked !== null ? (
                <Notice tone="info" banner>
                    {merge.blocked}
                </Notice>
            ) : null}
            {merge.error !== null ? (
                <Notice tone="danger" banner>
                    {merge.error}
                </Notice>
            ) : null}
            <View style={styles.danger}>
                <Button full busy={merge.busy} disabled={merge.blocked !== null} onPress={ask}>
                    {merge.busy ? t.merging : t.merge(merge.keptName)}
                </Button>
            </View>
        </Modal>
    );
}

/** Tick tags on or off for every selected client, or add a new one. */
export function TagSheet({ sel, onClose }: { sel: ClientSelection; onClose: () => void }) {
    const [draft, setDraft] = useState("");
    const n = sel.selected.length;
    const add = (): void => {
        sel.addTag(draft);
        setDraft("");
    };
    return (
        <Modal open onClose={onClose}>
            <SheetHeader
                title={t.applyTags(n)}
                onCancel={onClose}
                action={t.apply}
                onAction={sel.apply}
                busy={sel.busy}
                disabled={Object.keys(sel.pendingTags).length === 0}
            />
            {sel.tagState.map((tag) => {
                const pending = sel.pendingTags[tag.tag];
                const on = pending ?? tag.on === n;
                const mixed = pending === undefined && tag.on > 0 && tag.on < n;
                return (
                    <View key={tag.tag} style={styles.tagRow}>
                        <View style={styles.grow}>
                            <Checkbox
                                label={tag.tag}
                                value={on}
                                mixed={mixed}
                                onChange={() => {
                                    sel.toggleTag(tag.tag);
                                }}
                            />
                        </View>
                        <Text style={styles.hint}>
                            {mixed
                                ? t.onSome(tag.on, n)
                                : on && pending === undefined
                                  ? t.onAll
                                  : t.clientsCount(tag.count)}
                        </Text>
                    </View>
                );
            })}
            <View style={styles.newTag}>
                <View style={styles.grow}>
                    <TextField
                        size="sm"
                        name={t.newTag}
                        placeholder={t.newTag}
                        value={draft}
                        onChange={setDraft}
                        onSubmit={add}
                    />
                </View>
                <Button size="sm" variant="outline" disabled={draft.trim() === ""} onPress={add}>
                    {strings.clients.addShort}
                </Button>
            </View>
            {sel.error !== null ? <Notice tone="danger">{sel.error}</Notice> : null}
        </Modal>
    );
}

const styles = StyleSheet.create({
    head: {
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: 8,
        marginBottom: 4,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    side: { width: 84 },
    right: { alignItems: "flex-end" },
    title: { flex: 1, textAlign: "center", color: c.ink, fontSize: 17, fontWeight: "700" },
    archived: {
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        padding: 12,
        marginTop: 12,
        gap: 10,
    },
    archivedText: { color: c.warnFg, fontSize: 13, lineHeight: 18 },
    dup: {
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        padding: 12,
        marginTop: 12,
        gap: 6,
    },
    dupHead: { flexDirection: "row", alignItems: "center", gap: 10 },
    dupTitle: { flex: 1, color: c.ink, fontSize: 15, fontWeight: "700" },
    dupBody: { color: c.inkSoft, fontSize: 13, lineHeight: 18 },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    consent: {
        marginTop: 16,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    section: {
        marginTop: 22,
        paddingTop: 16,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    sectionTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    hint: { color: c.muted, fontSize: 12, lineHeight: 17 },
    danger: { marginTop: 24, gap: 4 },
    label: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 18,
        marginBottom: 8,
    },
    value: { color: c.ink, fontSize: 15 },
    tagRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.borderSoft,
    },
    grow: { flex: 1, minWidth: 0 },
    newTag: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
});
