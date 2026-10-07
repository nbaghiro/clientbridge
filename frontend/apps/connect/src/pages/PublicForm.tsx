import {
    createPublicFormClient,
    isAnswered,
    strings,
    useFormUploads,
    usePublicFormFill,
} from "@clientbridge/app-core/public";
import { Button, FormQuestion, Icon, Notice } from "@clientbridge/ui";
import { useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const forms = createPublicFormClient(config.apiUrl);
const s = strings.publicForm;

export function PublicForm() {
    const { token = "" } = useParams<{ token: string }>();
    const fill = usePublicFormFill(forms, token);
    const uploads = useFormUploads(fill);
    const form = fill.form;
    useEmbedSuccess(fill.status === "done", "form");

    if (fill.status === "loading") return <PublicStatus kind="loading" />;
    if (fill.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (fill.status === "error" || form === null)
        return (
            <PublicStatus
                kind="error"
                title={s.errorTitle}
                body={s.errorBody}
                onRetry={fill.retry}
            />
        );
    if (fill.status === "done")
        return (
            <PublicDone
                brand={form.brand}
                title={s.doneTitle}
                body={s.allDone(form.business_name)}
            />
        );

    const total = form.fields.length;
    const answered = form.fields.filter((f) => isAnswered(fill.answers[f.name])).length;
    const pct = Math.round((answered / Math.max(total, 1)) * 100);

    return (
        <PublicFrame size="xl" brand={form.brand}>
            <h1 className="font-display text-2xl font-bold text-ink">{form.form_name}</h1>
            <p className="mt-1.5 text-sm text-muted">{s.intro(form.business_name)}</p>
            <div className="mt-5 flex items-center gap-3">
                <div
                    role="progressbar"
                    aria-label={s.progress(answered, total)}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg"
                >
                    <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${String(pct)}%` }}
                    />
                </div>
                <span className="shrink-0 text-xs font-medium text-muted">
                    {s.progress(answered, total)}
                </span>
            </div>
            <div className="mt-7 space-y-6">
                {form.fields.map((f) => (
                    <FormQuestion
                        key={f.id}
                        field={f}
                        value={fill.answers[f.name]}
                        onChange={(v) => {
                            fill.setAnswer(f.name, v);
                        }}
                        onUpload={(file, name) => {
                            uploads.upload(f.name, file, name);
                        }}
                        fileName={uploads.fileNames[f.name] ?? null}
                        chooseFileLabel={s.chooseFile}
                        selectPlaceholder={s.selectPlaceholder}
                    />
                ))}
                {fill.error !== null ? (
                    <Notice tone="danger" banner>
                        {fill.error}
                    </Notice>
                ) : null}
                <div className="space-y-3 border-t border-line pt-5">
                    <Button size="lg" full busy={fill.busy} onPress={fill.submit}>
                        {fill.busy ? s.submitting : s.sendAnswers}
                    </Button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
                        <Icon name="lock" size={13} />
                        {s.privacy(form.business_name)}
                    </p>
                </div>
            </div>
        </PublicFrame>
    );
}
