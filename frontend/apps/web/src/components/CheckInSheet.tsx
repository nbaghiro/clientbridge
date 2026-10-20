import {
    type TodayActions,
    formatParts,
    strings,
    useCheckIn,
    useSubjectKind,
} from "@clientbridge/app-core";
import { Button, Modal, Notice, Skeleton, StatusPill } from "@clientbridge/ui";

import { api } from "../lib/api";

const t = strings.today;

/** The open check-in sheet and the short line that confirms a check-in. */
export function CheckInLayer({ actions }: { actions: TodayActions }) {
    return (
        <>
            {actions.notice !== null ? (
                <div className="mt-4">
                    <Notice tone="success" banner>
                        {actions.notice}
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
    const c = useCheckIn(api, bookingId, kind, onDone);
    const v = c.visit;
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
                        {v.depositDue === null ? null : (
                            <Notice tone="info" banner>
                                {t.checkInDeposit(v.depositDue)}
                            </Notice>
                        )}
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
