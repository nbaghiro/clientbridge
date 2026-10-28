import {
    type EstimateSegment,
    type InvoiceSegment,
    strings,
    useEstimateDesk,
    useInvoiceDesk,
    BUSINESS_CURRENCY,
    usePeoplePhotos,
    openRecord,
    openTask,
    useOpenRecord,
} from "@clientbridge/app-core";
import { Avatar, Button, Choice, ListPage, Money, StatusPill } from "@clientbridge/ui";
import { type ReactNode, useState } from "react";

import { DeskBar } from "../components/Desk";
import { useLinkIntent } from "../lib/links";

const s = strings.billing;
const GRID =
    "grid grid-cols-[4.5rem_minmax(0,2.2fr)_5.5rem_minmax(0,1.4fr)_6.5rem_6.5rem] items-center gap-4";
const EST_GRID =
    "grid grid-cols-[4.5rem_minmax(0,2.2fr)_minmax(0,1.6fr)_6.5rem] items-center gap-4";

type DocKind = "invoices" | "estimates";

export function Invoices() {
    const params = useLinkIntent({
        onCreate: () => {
            openTask({
                kind: "doc",
                doc: params.get("doc") === "estimates" ? "estimate" : "invoice",
            });
        },
        onOpen: (id) => {
            openRecord(params.get("doc") === "estimates" ? "estimate" : "invoice", id);
        },
    });
    const [doc, setDoc] = useState<DocKind>(
        params.get("doc") === "estimates" ? "estimates" : "invoices",
    );

    const switcher = (
        <Choice<DocKind>
            layout="segmented"
            label={s.invoices}
            options={[
                { key: "invoices", label: s.invoices },
                { key: "estimates", label: s.estimates },
            ]}
            value={doc}
            onChange={setDoc}
        />
    );

    return doc === "invoices" ? (
        <InvoiceDeskView switcher={switcher} />
    ) : (
        <EstimateDeskView switcher={switcher} />
    );
}

function InvoiceDeskView({ switcher }: { switcher: ReactNode }) {
    const openId = useOpenRecord("invoice");
    const compose = (): void => {
        openTask({ kind: "doc", doc: "invoice" });
    };
    const photos = usePeoplePhotos();
    const desk = useInvoiceDesk();
    return (
        <div className="@container space-y-6">
            <DeskBar
                switcher={switcher}
                summary={desk.summary}
                alert={desk.overdue}
                action={
                    desk.nothingYet ? null : (
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                compose();
                            }}
                        >
                            {s.newInvoice}
                        </Button>
                    )
                }
            />
            <ListPage<(typeof desk.rows)[number], InvoiceSegment>
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
                head={
                    desk.nothingYet ? undefined : (
                        <div className={GRID}>
                            <span>{s.colNumber}</span>
                            <span>{s.colClient}</span>
                            <span>{s.colIssued}</span>
                            <span>{s.colStatus}</span>
                            <span className="text-right">{s.colTotal}</span>
                            <span className="text-right">{s.colBalance}</span>
                        </div>
                    )
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
                    <div className={GRID}>
                        <span className="font-medium tabular-nums text-ink">{r.number}</span>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={r.row.client_name ?? ""}
                                src={photos.client(r.row.client_id)}
                                size="sm"
                            />
                            <span className="truncate font-medium text-ink">
                                {r.row.client_name}
                            </span>
                        </span>
                        <span className="text-ink-soft">{r.issuedLabel}</span>
                        <span className="flex min-w-0 flex-col items-start gap-1">
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                            <span
                                className={`truncate text-xs ${r.late ? "font-medium text-danger" : "text-muted"}`}
                            >
                                {r.dueLabel}
                            </span>
                        </span>
                        <span className="text-right">
                            <Money currency={BUSINESS_CURRENCY} cents={r.totalCents} tone="muted" />
                        </span>
                        <span className="text-right">
                            {(r.row.balance_cents ?? 0) > 0 && r.status !== "void" ? (
                                <Money
                                    currency={BUSINESS_CURRENCY}
                                    cents={r.row.balance_cents}
                                    strong
                                    tone={r.late ? "danger" : "ink"}
                                />
                            ) : (
                                <span className="text-muted">{s.dash}</span>
                            )}
                        </span>
                    </div>
                )}
            />
        </div>
    );
}

function EstimateDeskView({ switcher }: { switcher: ReactNode }) {
    const openId = useOpenRecord("estimate");
    const compose = (): void => {
        openTask({ kind: "doc", doc: "estimate" });
    };
    const photos = usePeoplePhotos();
    const desk = useEstimateDesk();
    return (
        <div>
            <DeskBar
                switcher={switcher}
                summary={desk.summary}
                action={
                    desk.nothingYet ? null : (
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                compose();
                            }}
                        >
                            {s.newEstimate}
                        </Button>
                    )
                }
            />
            <ListPage<(typeof desk.rows)[number], EstimateSegment>
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
                head={
                    desk.nothingYet ? undefined : (
                        <div className={EST_GRID}>
                            <span>{s.colNumber}</span>
                            <span>{s.colClient}</span>
                            <span>{s.colStatus}</span>
                            <span className="text-right">{s.colTotal}</span>
                        </div>
                    )
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
                    <div className={EST_GRID}>
                        <span className="font-medium tabular-nums text-ink">{r.number}</span>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={r.row.client_name ?? ""}
                                src={photos.client(r.row.client_id)}
                                size="sm"
                            />
                            <span className="truncate font-medium text-ink">
                                {r.row.client_name}
                            </span>
                        </span>
                        <span className="flex min-w-0 flex-col items-start gap-1">
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                            <span className="truncate text-xs text-muted">{r.validLabel}</span>
                        </span>
                        <span className="text-right">
                            <Money currency={BUSINESS_CURRENCY} cents={r.row.total_cents} />
                        </span>
                    </div>
                )}
            />
        </div>
    );
}
