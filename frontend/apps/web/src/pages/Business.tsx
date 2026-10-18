import {
    BUSINESS_ADDRESS_FIELDS,
    BUSINESS_TEXT_FIELDS,
    strings,
    subjectChoices,
    timeZoneOptions,
    useBusinessForm,
} from "@clientbridge/app-core";

import {
    Button,
    Choice,
    confirm,
    Field,
    Loading,
    Notice,
    Panel,
    Select,
    TextField,
} from "@clientbridge/ui";
import { api } from "../lib/api";

export function Business() {
    const form = useBusinessForm(api);
    const fields = form.fields;
    const save = (): void => {
        if (form.subjectChange === null) {
            form.submit();
            return;
        }
        confirm({
            title: strings.subjects.changeTitle,
            message: form.subjectChange,
            confirmLabel: strings.subjects.changeConfirm,
        })
            .then((ok) => {
                if (ok) form.submit();
            })
            .catch(() => undefined);
    };

    return (
        <div>
            <p className="mt-1 text-sm text-muted">{strings.business.subtitle}</p>

            <div className="mt-6 max-w-lg space-y-6">
                {fields === null ? (
                    <Panel>
                        <Loading inline />
                    </Panel>
                ) : (
                    <form
                        className="space-y-6"
                        onSubmit={(e) => {
                            e.preventDefault();
                            save();
                        }}
                    >
                        <Panel>
                            {BUSINESS_TEXT_FIELDS.map((f) => (
                                <TextField
                                    key={f.key}
                                    label={f.label}
                                    value={fields[f.key]}
                                    onChange={(v) => {
                                        form.set(f.key, v);
                                    }}
                                    placeholder={f.placeholder}
                                    size="lg"
                                />
                            ))}
                            <Select
                                label={strings.business.timezoneLabel}
                                value={fields.timezone}
                                options={timeZoneOptions(fields.timezone)}
                                onChange={(v) => {
                                    form.set("timezone", v);
                                }}
                                size="lg"
                            />
                            <Field
                                label={strings.subjects.choiceLabel}
                                hint={strings.subjects.choiceHelp}
                            >
                                <Choice
                                    label={strings.subjects.choiceLabel}
                                    layout="cards"
                                    options={subjectChoices()}
                                    value={form.subject}
                                    onChange={form.setSubject}
                                />
                            </Field>
                        </Panel>
                        <Panel
                            title={strings.business.legalAddress.title}
                            subtitle={strings.business.legalAddress.hint}
                        >
                            {BUSINESS_ADDRESS_FIELDS.map((f) => (
                                <TextField
                                    key={f.key}
                                    label={f.label}
                                    type={f.type}
                                    autoComplete={f.autoComplete}
                                    value={fields[f.key]}
                                    onChange={(v) => {
                                        form.set(f.key, v);
                                    }}
                                    placeholder={f.placeholder}
                                    size="lg"
                                />
                            ))}
                            <TextField
                                label={strings.business.legalAddress.province}
                                hint={strings.business.legalAddress.provinceHint}
                                value={form.province}
                                disabled
                                size="lg"
                            />
                        </Panel>
                        {form.error !== null && <Notice tone="danger">{form.error}</Notice>}
                        {form.saved && <Notice tone="success">{strings.common.saved}</Notice>}
                        <Button submit busy={form.busy}>
                            {form.busy ? strings.common.saving : strings.common.save}
                        </Button>
                    </form>
                )}
            </div>
        </div>
    );
}
