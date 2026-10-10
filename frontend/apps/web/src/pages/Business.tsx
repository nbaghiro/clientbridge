import { BUSINESS_TEXT_FIELDS, strings, useBusinessForm } from "@clientbridge/app-core";

import { Button, Loading, Notice, Panel, TextField } from "@clientbridge/ui";
import { api } from "../lib/api";

export function Business() {
    const form = useBusinessForm(api);
    const fields = form.fields;

    return (
        <div>
            <p className="mt-1 text-sm text-muted">{strings.business.subtitle}</p>

            <div className="mt-6 max-w-lg">
                <Panel>
                    {fields === null ? (
                        <Loading inline />
                    ) : (
                        <form
                            className="space-y-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                form.submit();
                            }}
                        >
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
                            {form.error !== null && <Notice tone="danger">{form.error}</Notice>}
                            {form.saved && <Notice tone="success">{strings.common.saved}</Notice>}
                            <Button submit busy={form.busy}>
                                {form.busy ? strings.common.saving : strings.common.save}
                            </Button>
                        </form>
                    )}
                </Panel>
            </div>
        </div>
    );
}
