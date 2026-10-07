import { type ClientListRow, strings, useClientMerge } from "@clientbridge/app-core";
import { Button, Choice, confirm, Icon, Modal, Notice } from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.clients.tidy;

/** Pick the record that stays, then each field's value; shows what moves over before merging. */
export function ClientMergeDialog({
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
            title: s.mergeTitle,
            message: s.mergeConfirmBody(merge.goneName, merge.keptName),
            confirmLabel: s.mergeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) merge.submit();
            })
            .catch(() => undefined);
    };
    const side = (k: "a" | "b"): { key: "a" | "b"; label: string; hint: string } => ({
        key: k,
        label: merge.sides[k].client.name,
        hint: merge.sides[k].hint,
    });

    return (
        <Modal onClose={onClose} size="lg">
            <h2 className="mb-4 font-display text-lg font-bold text-ink">{s.mergeTitle}</h2>
            <div className="-mx-6 max-h-[calc(100vh-10rem)] space-y-5 overflow-y-auto px-6">
                <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.whichToKeep}
                    </h3>
                    <div className="mt-2">
                        <Choice
                            layout="cards"
                            label={s.whichToKeep}
                            options={[side("a"), side("b")]}
                            value={merge.keep}
                            onChange={merge.setKeep}
                        />
                    </div>
                </section>
                <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.chooseValues}
                    </h3>
                    <div className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-surface">
                        {merge.fields.map((f) => (
                            <div
                                key={f.key}
                                className="grid grid-cols-[80px_1fr] items-center gap-3 px-4 py-3"
                            >
                                <span className="text-sm text-muted">{f.label}</span>
                                {f.same ? (
                                    <span className="flex items-center gap-2 text-sm text-ink">
                                        {f.a || s.none}
                                        <span className="flex items-center gap-1 text-xs text-muted">
                                            <Icon name="check" size={13} />
                                            {s.same}
                                        </span>
                                    </span>
                                ) : (
                                    <Choice
                                        layout="cards"
                                        label={f.label}
                                        options={(["a", "b"] as const).map((k) => ({
                                            key: k,
                                            label: f[k] || s.none,
                                            disabled: f[k] === "",
                                        }))}
                                        value={f.chosen}
                                        onChange={(k) => {
                                            merge.choose(f.key, k);
                                        }}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </section>
                <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.whatMoves}
                    </h3>
                    {merge.moves.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">{s.nothingMoves}</p>
                    ) : (
                        <ul className="mt-2 flex flex-wrap gap-2">
                            {merge.moves.map((m) => (
                                <li
                                    key={m}
                                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-soft"
                                >
                                    <Icon name="arrowRight" size={13} />
                                    {m}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
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
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
                <span className="flex-1" />
                <Button busy={merge.busy} disabled={merge.blocked !== null} onPress={ask}>
                    {merge.busy ? s.merging : s.merge(merge.keptName)}
                </Button>
            </div>
        </Modal>
    );
}
