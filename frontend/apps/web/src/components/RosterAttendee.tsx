import { type RosterEntry, strings } from "@clientbridge/app-core";
import { Avatar, Badge, Button, StatusPill } from "@clientbridge/ui";

const s = strings.classes;

interface RosterActions {
    checkIn: (key: string) => void;
    undo: (key: string) => void;
    noShow: (key: string) => void;
}

/** One person on a session's roster: who they are, pickups, and check-in once the day comes. */
export function RosterAttendee({
    a,
    started,
    actions,
}: {
    a: RosterEntry;
    started: boolean;
    actions: RosterActions;
}) {
    return (
        <li className="flex items-center gap-3 px-5 py-3">
            <Avatar name={a.subjectName} />
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm">
                    <span className="font-semibold text-ink">{a.subjectName}</span>
                    {a.subjectName !== a.clientName ? (
                        <span className="truncate text-muted">{a.clientName}</span>
                    ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="truncate">{a.subjectDetail}</span>
                    {a.note !== null ? <Badge label={a.note} intent="warning" /> : null}
                    {a.paid ? null : <Badge label={s.unpaid} intent="danger" />}
                </p>
                {a.pickup !== null ? (
                    <p className="mt-0.5 truncate text-xs text-muted">{a.pickup}</p>
                ) : null}
            </div>
            {a.status === "confirmed" && started ? null : (
                <StatusPill status={a.statusLabel} intent={a.intent} />
            )}
            <div className="flex justify-end gap-1.5">
                {a.status === "confirmed" && started ? (
                    <>
                        <Button
                            size="sm"
                            variant="quiet"
                            onPress={() => {
                                actions.noShow(a.key);
                            }}
                        >
                            {s.noShow}
                        </Button>
                        <Button
                            size="sm"
                            onPress={() => {
                                actions.checkIn(a.key);
                            }}
                        >
                            {s.checkIn}
                        </Button>
                    </>
                ) : a.status === "checked_in" || a.status === "no_show" ? (
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            actions.undo(a.key);
                        }}
                    >
                        {s.undo}
                    </Button>
                ) : null}
            </div>
        </li>
    );
}
