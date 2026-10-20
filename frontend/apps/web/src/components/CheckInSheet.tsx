import {
    type TodayActions,
    formatParts,
    strings,
    useCheckIn,
    useSubjectKind,
} from "@clientbridge/app-core";
import { Button, Modal, Notice, Skeleton, StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { config } from "../config";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const t = strings.today;

/** The open check-in sheet and the short line that confirms a check-in. */
export function CheckInLayer({ actions }: { actions: TodayActions }) {
    return (
        <>
            {actions.notice !== null ? (
                <div className="mt-4">
                    <Notice tone="success" banner>
                        <span className="flex items-center justify-between gap-3">
                            {actions.notice}
                            {actions.undoCheckIn === null ? null : (
                                <Button size="sm" variant="outline" onPress={actions.undoCheckIn}>
                                    {t.undoCheckIn}
                                </Button>
                            )}
                        </span>
                    </Notice>
                </div>
            ) : null}
            {actions.checkingIn !== null ? (
                <CheckInSheet
                    bookingId={actions.checkingIn}
                    onClose={actions.closeCheckIn}
                    onDone={actions.checkedIn}
                />
            ) : null}
        </>
    );
}

export function CheckInSheet({
    bookingId,
    onClose,
    onDone,
}: {
    bookingId: string;
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    const kind = useSubjectKind();
    const c = useCheckIn(api, bookingId, kind, useViewer(), onDone);
    const [handOver, setHandOver] = useState<string | null>(null);
    const v = c.visit;
    if (handOver !== null)
        return (
            <Modal
                size="xl"
                framed={false}
                onClose={() => {
                    setHandOver(null);
                    c.refreshNeeds();
                }}
            >
                <div className="flex h-[85vh] flex-col overflow-hidden rounded-lg bg-surface">
                    <div className="flex justify-end border-b border-line px-4 py-2">
                        <Button
                            variant="outline"
                            onPress={() => {
                                setHandOver(null);
                                c.refreshNeeds();
                            }}
                        >
                            {strings.common.done}
                        </Button>
                    </div>
                    <iframe
                        title={c.title}
                        src={`${config.bookUrl}${handOver}`}
                        className="min-h-0 w-full flex-1"
                    />
                </div>
            </Modal>
        );
    return (
        <Modal size="sm" onClose={onClose}>
            <div className="space-y-4">
                <h2 className="font-display text-lg font-bold text-ink">{c.title}</h2>
                {v === null ? (
                    <Skeleton variant="row" count={2} label={t.loading} />
                ) : (
                    <>
                        <div>
                            <p className="text-base font-semibold text-ink">
                                {formatParts([v.subjectName, v.clientName])}
                            </p>
                            <p className="mt-0.5 text-sm text-muted">
                                {formatParts([
                                    v.serviceName,
                                    v.time,
                                    v.staffName === null ? null : t.withStaff(v.staffName),
                                ])}
                            </p>
                            {v.temperament === null ? null : (
                                <p className="mt-0.5 text-sm text-muted">
                                    {t.checkInTemperament(v.temperament)}
                                </p>
                            )}
                        </div>
                        {v.alerts.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted">{t.checkInWatch}</p>
                                <div className="flex flex-wrap gap-2">
                                    {v.alerts.map((a) => (
                                        <StatusPill
                                            key={a.key}
                                            status={a.label}
                                            intent={a.intent}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {c.needs.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted">{t.checkInNeeds}</p>
                                <ul className="divide-y divide-line-soft rounded-md border border-line">
                                    {c.needs.map((n) => (
                                        <li
                                            key={n.key}
                                            className="flex items-center gap-2 px-3 py-2"
                                        >
                                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                                {n.label}
                                            </span>
                                            {n.openPath === null ? null : (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onPress={() => {
                                                        setHandOver(n.openPath);
                                                    }}
                                                >
                                                    {t.needOpen}
                                                </Button>
                                            )}
                                            {n.canSend ? (
                                                <Button
                                                    size="sm"
                                                    variant="quiet"
                                                    busy={n.sending}
                                                    onPress={n.send}
                                                >
                                                    {n.openPath === null
                                                        ? t.needSend
                                                        : t.needResend}
                                                </Button>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </>
                )}
                {c.error !== null ? <Notice tone="danger">{c.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button busy={c.busy} disabled={v === null} onPress={c.submit}>
                        {c.title}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
