import {
    type EstimateSegment,
    type InvoiceSegment,
    strings,
    useEstimateDesk,
    useInvoiceDesk,
    formatParts,
    BUSINESS_CURRENCY,
    usePeoplePhotos,
    openRecord,
    openTask,
    useOpenRecord,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar, Button, ListPage, Money, StatusPill, Tabs } from "@clientbridge/ui";

const c = theme.colors;
const s = strings.billing;

type DocKind = "invoices" | "estimates";

export function Invoices() {
    const [doc, setDoc] = useState<DocKind>("invoices");
    return (
        <View style={styles.screen}>
            <Tabs<DocKind>
                variant="pill"
                label={s.invoices}
                items={[
                    { key: "invoices", label: s.invoices },
                    { key: "estimates", label: s.estimates },
                ]}
                active={doc}
                onSelect={setDoc}
            />
            {doc === "invoices" ? <InvoiceDeskView /> : <EstimateDeskView />}
        </View>
    );
}

function InvoiceDeskView() {
    const openId = useOpenRecord("invoice");
    const compose = (): void => {
        openTask({ kind: "doc", doc: "invoice" });
    };
    const photos = usePeoplePhotos();
    const desk = useInvoiceDesk();
    return (
        <View style={styles.screen}>
            <ListPage<(typeof desk.rows)[number], InvoiceSegment>
                summary={desk.summary}
                alert={desk.overdue}
                action={
                    desk.nothingYet
                        ? undefined
                        : {
                              label: s.newInvoice,
                              onPress: () => {
                                  compose();
                              },
                          }
                }
                segments={
                    desk.nothingYet
                        ? undefined
                        : {
                              items: desk.segments,
                              active: desk.segment,
                              onSelect: desk.setSegment,
                              layout: "menu",
                          }
                }
                search={
                    desk.nothingYet
                        ? undefined
                        : { value: desk.q, onChange: desk.setQ, placeholder: s.search }
                }
                rows={desk.rows}
                rowKey={(r) => r.row.id}
                onRowPress={(r) => {
                    openRecord("invoice", r.row.id);
                }}
                selectedKey={openId ?? undefined}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={
                    desk.nothingYet
                        ? {
                              message: s.emptyInvoicesTitle,
                              body: s.emptyInvoicesBody,
                              icon: "invoices",
                              variant: "card",
                              actions: (
                                  <Button
                                      icon="plus"
                                      onPress={() => {
                                          compose();
                                      }}
                                  >
                                      {s.newInvoice}
                                  </Button>
                              ),
                          }
                        : desk.emptyMessage
                }
                renderRow={(r) => (
                    <View style={styles.row}>
                        <Avatar
                            name={r.row.client_name ?? ""}
                            src={photos.client(r.row.client_id)}
                            size="sm"
                        />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {r.row.client_name}
                            </Text>
                            <Text style={[styles.rowSub, r.late && styles.late]} numberOfLines={1}>
                                {formatParts([r.number, r.dueLabel])}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Money
                                currency={BUSINESS_CURRENCY}
                                cents={
                                    (r.row.balance_cents ?? 0) > 0
                                        ? r.row.balance_cents
                                        : r.totalCents
                                }
                                strong
                                tone={r.late ? "danger" : "ink"}
                            />
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                        </View>
                    </View>
                )}
            />
        </View>
    );
}

function EstimateDeskView() {
    const openId = useOpenRecord("estimate");
    const compose = (): void => {
        openTask({ kind: "doc", doc: "estimate" });
    };
    const photos = usePeoplePhotos();
    const desk = useEstimateDesk();
    return (
        <View style={styles.screen}>
            <ListPage<(typeof desk.rows)[number], EstimateSegment>
                summary={desk.summary}
                action={
                    desk.nothingYet
                        ? undefined
                        : {
                              label: s.newEstimate,
                              onPress: () => {
                                  compose();
                              },
                          }
                }
                segments={
                    desk.nothingYet
                        ? undefined
                        : {
                              items: desk.segments,
                              active: desk.segment,
                              onSelect: desk.setSegment,
                              layout: "menu",
                          }
                }
                search={
                    desk.nothingYet
                        ? undefined
                        : { value: desk.q, onChange: desk.setQ, placeholder: s.search }
                }
                rows={desk.rows}
                rowKey={(r) => r.row.id}
                onRowPress={(r) => {
                    openRecord("estimate", r.row.id);
                }}
                selectedKey={openId ?? undefined}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={
                    desk.nothingYet
                        ? {
                              message: s.emptyEstimatesTitle,
                              body: s.emptyEstimatesBody,
                              icon: "receipt",
                              variant: "card",
                              actions: (
                                  <Button
                                      icon="plus"
                                      onPress={() => {
                                          compose();
                                      }}
                                  >
                                      {s.newEstimate}
                                  </Button>
                              ),
                          }
                        : desk.emptyMessage
                }
                renderRow={(r) => (
                    <View style={styles.row}>
                        <Avatar
                            name={r.row.client_name ?? ""}
                            src={photos.client(r.row.client_id)}
                            size="sm"
                        />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {r.row.client_name}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {formatParts([r.number, r.validLabel])}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Money currency={BUSINESS_CURRENCY} cents={r.row.total_cents} strong />
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                        </View>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1, minWidth: 0 },
    rowName: { fontFamily: theme.fonts.ui, fontSize: 16, fontWeight: "600", color: c.ink },
    rowSub: { fontFamily: theme.fonts.ui, fontSize: 13, color: c.muted, marginTop: 2 },
    late: { color: c.danFg },
    rowRight: { alignItems: "flex-end", gap: 4 },
});
