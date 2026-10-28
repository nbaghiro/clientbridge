import {
    type ContractSummary,
    type SignatureRequest,
    contractClauses,
    signatureActivity,
    signatureBlock,
    signatureHistory,
    signatureIntent,
    signedText,
    strings,
    useContractLibrary,
    useContractDraft,
    useNewContract,
    usePeoplePhotos,
    useSignatureActions,
    formatParts,
    useBusinessZone,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActivityTimeline,
    Avatar,
    Button,
    ContractDocument,
    Empty,
    IconButton,
    ListRow,
    Modal,
    Notice,
    PageHeader,
    Panel,
    SheetHeader,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { Loaded } from "../components/Loaded";
import { SendToClientSheet } from "../components/SendToClient";
import { api } from "../lib/api";
import { bookUrl } from "../lib/config";

const c = theme.colors;
const s = strings.contracts;

const shareText = (text: string): void => {
    Share.share({ message: text }).catch(() => undefined);
};

export function Contracts() {
    const library = useContractLibrary();
    const [openId, setOpenId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const open = library.contracts.find((x) => x.contract.id === openId) ?? null;
    if (open !== null)
        return (
            <ContractDetail
                summary={open}
                issuer={library.issuer}
                onBack={() => {
                    setOpenId(null);
                }}
            />
        );
    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.top}>
                <Text style={styles.subtitle}>{s.subtitle}</Text>
                {library.load.hasData && library.contracts.length === 0 ? null : (
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        icon="plus"
                        onPress={() => {
                            setAdding(true);
                        }}
                    >
                        {s.newContract}
                    </Button>
                )}
            </View>
            <Loaded flush load={library.load} loading={s.loading} failed={s.loadError}>
                {library.contracts.length === 0 ? (
                    <Empty
                        variant="card"
                        icon="note"
                        message={s.noContractsTitle}
                        body={s.noContractsBody}
                        actions={
                            <Button
                                size="sm"
                                icon="plus"
                                onPress={() => {
                                    setAdding(true);
                                }}
                            >
                                {s.newContract}
                            </Button>
                        }
                    />
                ) : (
                    <Panel flush>
                        {library.contracts.map((x) => (
                            <ListRow
                                key={x.contract.id}
                                title={x.contract.name}
                                detail={formatParts([
                                    s.versionShort(x.contract.version),
                                    s.signedCount(x.signed),
                                    s.waitingCount(x.waiting),
                                ])}
                                onPress={() => {
                                    setOpenId(x.contract.id);
                                }}
                            />
                        ))}
                    </Panel>
                )}
            </Loaded>
            {adding ? (
                <NewContractSheet
                    onClose={() => {
                        setAdding(false);
                    }}
                    onCreated={(id) => {
                        setAdding(false);
                        setOpenId(id);
                    }}
                />
            ) : null}
        </ScrollView>
    );
}

function ContractDetail({
    summary,
    issuer,
    onBack,
}: {
    summary: ContractSummary;
    issuer: string;
    onBack: () => void;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const actions = useSignatureActions(api, bookUrl, shareText);
    const [sending, setSending] = useState(false);
    const [viewing, setViewing] = useState<SignatureRequest | null>(null);
    const k = summary.contract;
    const [editing, setEditing] = useState(false);
    const draft = useContractDraft(api, k, () => {
        setEditing(false);
    });
    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.nav}>
                <IconButton icon="chevronLeft" label={s.templates} onPress={onBack} />
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    icon="send"
                    onPress={() => {
                        setSending(true);
                    }}
                >
                    {s.send}
                </Button>
            </View>
            <PageHeader title={k.name} />
            <Text style={styles.meta}>
                {formatParts([
                    s.version(k.version),
                    s.signedCount(summary.signed),
                    s.waitingCount(summary.waiting),
                ])}
            </Text>
            <Text style={styles.section}>{s.signatures}</Text>
            {summary.requests.length === 0 ? <Empty message={s.noSignatures} /> : null}
            <Panel flush>
                {summary.requests.map((r) => {
                    const waiting = r.state === "pending" || r.state === "opened";
                    return (
                        <ListRow
                            key={r.id}
                            leading={
                                <Avatar
                                    name={r.client_name ?? ""}
                                    src={photos.client(r.client_id)}
                                    size="sm"
                                />
                            }
                            title={r.client_name ?? ""}
                            detail={signatureActivity(r, zone)}
                            meta={
                                <StatusPill
                                    status={s.status[r.state]}
                                    intent={signatureIntent(r.state)}
                                />
                            }
                            onPress={
                                r.state === "signed"
                                    ? () => {
                                          setViewing(r);
                                      }
                                    : undefined
                            }
                            trailing={
                                waiting ? (
                                    <View style={styles.row}>
                                        <IconButton
                                            icon="external"
                                            label={s.shareLink}
                                            onPress={() => {
                                                actions.copy(r);
                                            }}
                                        />
                                        <IconButton
                                            icon={actions.resent.has(r.id) ? "check" : "send"}
                                            label={actions.resent.has(r.id) ? s.resent : s.resend}
                                            disabled={
                                                actions.busyId === r.id || actions.resent.has(r.id)
                                            }
                                            onPress={() => {
                                                actions.resend(r);
                                            }}
                                        />
                                    </View>
                                ) : undefined
                            }
                        />
                    );
                })}
            </Panel>
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            <Text style={styles.section}>{s.text}</Text>
            <ContractDocument
                density="compact"
                issuer={issuer}
                title={k.name}
                meta={s.version(k.version)}
                clauses={contractClauses(k.body)}
            />
            <Button
                variant="outline"
                icon="edit"
                onPress={() => {
                    setEditing(true);
                }}
            >
                {s.editText}
            </Button>
            {editing ? (
                <Modal
                    open
                    size="xl"
                    onClose={() => {
                        setEditing(false);
                    }}
                >
                    <View style={{ gap: 16 }}>
                        <SheetHeader title={s.editText} />
                        <TextField
                            label={s.text}
                            multiline
                            rows={12}
                            value={draft.body}
                            onChange={draft.setBody}
                            surface="surface"
                        />
                        <Notice tone="info">{s.versionNotice(draft.nextVersion)}</Notice>
                        {draft.failed ? <Notice tone="danger">{s.publishError}</Notice> : null}
                        <Button onPress={draft.publish} busy={draft.busy} disabled={!draft.changed}>
                            {draft.busy ? s.publishing : s.publish(draft.nextVersion)}
                        </Button>
                        <Button
                            variant="quiet"
                            onPress={() => {
                                setEditing(false);
                            }}
                        >
                            {s.cancel}
                        </Button>
                    </View>
                </Modal>
            ) : null}
            {sending ? (
                <SendToClientSheet
                    title={s.sendTitle(k.name)}
                    path="/v1/contracts/send"
                    body={{ contract_id: k.id }}
                    onClose={() => {
                        setSending(false);
                    }}
                />
            ) : null}
            {viewing !== null ? (
                <Modal
                    open
                    size="xl"
                    onClose={() => {
                        setViewing(null);
                    }}
                >
                    <ScrollView contentContainerStyle={styles.gap}>
                        <ContractDocument
                            issuer={issuer}
                            title={viewing.contract_name}
                            meta={s.version(viewing.version)}
                            clauses={contractClauses(signedText(viewing, k.body))}
                            signature={signatureBlock(viewing, zone)}
                        />
                        <Text style={styles.section}>{s.history}</Text>
                        <ActivityTimeline entries={signatureHistory(viewing, zone)} />
                        <Button
                            variant="outline"
                            onPress={() => {
                                setViewing(null);
                            }}
                        >
                            {s.close}
                        </Button>
                    </ScrollView>
                </Modal>
            ) : null}
        </ScrollView>
    );
}

function NewContractSheet({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const draft = useNewContract(api, onCreated);
    return (
        <Modal open size="xl" onClose={onClose}>
            <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
                <SheetHeader title={s.newTitle} />
                <TextField
                    label={s.nameLabel}
                    value={draft.name}
                    onChange={draft.setName}
                    placeholder={s.namePlaceholder}
                    error={draft.problem === "name-missing" ? s.newErrors["name-missing"] : null}
                />
                <TextField
                    label={s.text}
                    hint={s.newHint}
                    multiline
                    rows={10}
                    value={draft.body}
                    onChange={draft.setBody}
                    placeholder={s.bodyPlaceholder}
                    error={draft.problem === "body-missing" ? s.newErrors["body-missing"] : null}
                />
                {draft.problem === "failed" ? (
                    <Notice tone="danger">{s.newErrors.failed}</Notice>
                ) : null}
                <View style={styles.row}>
                    <View style={styles.flex}>
                        <Button full variant="outline" onPress={onClose}>
                            {s.cancel}
                        </Button>
                    </View>
                    <View style={styles.flex}>
                        <Button full busy={draft.busy} onPress={draft.create}>
                            {draft.busy ? s.creating : s.create}
                        </Button>
                    </View>
                </View>
            </ScrollView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    body: { padding: 16, paddingBottom: 40, gap: 12 },
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    subtitle: { flex: 1, color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    meta: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 },
    section: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 8,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    flex: { flex: 1 },
    gap: { gap: 14 },
});
