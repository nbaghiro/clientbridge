import { type PendingChange, strings } from "@clientbridge/app-core";
import { Button, Icon, Modal } from "@clientbridge/ui";

const t = strings.sync;

/** Names the changes still on this device before signing out would wipe them. */
export function SignOutDialog({
    open,
    pending,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    pending: PendingChange[];
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal open={open} onClose={onCancel} size="md">
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger">
                    <Icon name="alert" size={19} />
                </span>
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{t.signOutTitle}</h2>
                    <p className="mt-1 text-sm text-muted">{t.signOutBody(pending.length)}</p>
                </div>
            </div>
            <div className="mt-4 rounded-md border border-line bg-bg px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t.signOutListTitle}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-ink">
                    {pending.map((p) => (
                        <li key={p.id}>{p.label}</li>
                    ))}
                </ul>
            </div>
            <p className="mt-3 text-sm text-muted">{t.signOutSafe}</p>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="danger" onPress={onConfirm}>
                    {t.signOutConfirm}
                </Button>
                <Button onPress={onCancel}>{t.signOutCancel}</Button>
            </div>
        </Modal>
    );
}
