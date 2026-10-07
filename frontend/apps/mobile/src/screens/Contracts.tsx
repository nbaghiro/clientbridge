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
    useNewContract,
    useSignatureActions,
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
const s = strings.contracts.page;

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
                <Button
                    size="sm"
                    icon="plus"
                    onPress={() => {
                        setAdding(true);
                    }}
                >
                    {s.newContract}
                </Button>
            </View>
            <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                {library.contracts.length === 0 ? (
                    <Empty
                        variant="card"
                        icon="note"
                        message={s.noContractsTitle}
                        body={s.noContractsBody}
                    />
                ) : (
                    <View style={styles.list}>
                        {library.contracts.map((x) => (
                            <ListRow
                                key={x.contract.id}
                                title={x.contract.name}
                                detail={[
                                    s.versionShort(x.contract.version),
                                    s.signedCount(x.signed),
                                    s.waitingCount(x.waiting),
                                ].join(" · ")}
                                onPress={() => {
                                    setOpenId(x.contract.id);
                                }}
                            />
                        ))}
                    </View>
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
    const actions = useSignatureActions(api, bookUrl, shareText);
    const [sending, setSending] = useState(false);
    const [viewing, setViewing] = useState<SignatureRequest | null>(null);
    const k = summary.contract;
    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.nav}>
                <Button variant="link" icon="chevronLeft" onPress={onBack}>
                    {s.templates}
                </Button>
                <Button
                    size="sm"
                    icon="send"
                    onPress={() => {
                        setSending(true);
                    }}
                >
                    {s.send}
                </Button>
            </View>
            <Text style={styles.title}>{k.name}</Text>
            <Text style={styles.meta}>
                {s.version(k.version)} · {s.signedCount(summary.signed)} ·{" "}
                {s.waitingCount(summary.waiting)}
            </Text>
            <Text style={styles.section}>{s.signatures}</Text>
            {summary.requests.length === 0 ? <Empty message={s.noSignatures} /> : null}
            <View style={styles.list}>
                {summary.requests.map((r) => {
                    const waiting = r.state === "pending" || r.state === "opened";
                    return (
                        <ListRow
                            key={r.id}
                            leading={<Avatar name={r.client_name ?? ""} size="sm" />}
                            title={r.client_name ?? ""}
                            detail={signatureActivity(r)}
                            meta={
                                <StatusPill
                                    status={s.status[r.state] ?? r.state}
                                    intent={signatureIntent(r.state)}
                                    asWritten
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
            </View>
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            <Text style={styles.section}>{s.text}</Text>
            <ContractDocument
                density="compact"
                issuer={issuer}
                title={k.name}
                meta={s.version(k.version)}
                clauses={contractClauses(k.body)}
            />
            <Text style={styles.meta}>{s.editOnWeb}</Text>
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
                            signature={signatureBlock(viewing)}
                        />
                        <Text style={styles.section}>{s.history}</Text>
                        <ActivityTimeline entries={signatureHistory(viewing)} />
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
                <Text style={styles.title}>{s.newTitle}</Text>
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
    subtitle: { flex: 1, color: c.muted, fontSize: 13 },
    nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { color: c.ink, fontSize: 22, fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, lineHeight: 18 },
    section: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 8,
    },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    flex: { flex: 1 },
    gap: { gap: 14 },
});
