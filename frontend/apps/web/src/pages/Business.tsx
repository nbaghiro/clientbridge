import {
    BUSINESS_TEXT_FIELDS,
    strings,
    timeZoneOptions,
    useBusinessForm,
    useDiscountSettings,
} from "@clientbridge/app-core";

import { Button, Loading, Notice, Panel, Select, TextField } from "@clientbridge/ui";
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
                            <Select
                                label={strings.business.timezoneLabel}
                                value={fields.timezone}
                                options={timeZoneOptions(fields.timezone)}
                                onChange={(v) => {
                                    form.set("timezone", v);
                                }}
                                size="lg"
                            />
                            {form.error !== null && <Notice tone="danger">{form.error}</Notice>}
                            {form.saved && <Notice tone="success">{strings.common.saved}</Notice>}
                            <Button submit busy={form.busy}>
                                {form.busy ? strings.common.saving : strings.common.save}
                            </Button>
                        </form>
                    )}
                </Panel>
                <DiscountSettings />
            </div>
        </div>
    );
}

function DiscountSettings() {
    const form = useDiscountSettings(api);
    return (
        <Panel title={strings.business.discountTitle}>
            <TextField
                label={strings.business.discountLimit}
                value={form.limit}
                onChange={form.setLimit}
                disabled={!form.ready || form.busy}
            />
            <Button onPress={form.saveLimit} busy={form.busy} disabled={!form.ready}>
                {strings.business.saveDiscount}
            </Button>
            <TextField
                label={strings.business.approvalPin}
                hint={strings.business.pinHint}
                type="password"
                maxLength={4}
                value={form.pin}
                onChange={form.setPin}
                disabled={form.busy}
                autoComplete="new-password"
            />
            <Button onPress={form.savePin} busy={form.busy} disabled={form.pin.length !== 4}>
                {strings.business.savePin}
            </Button>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            {form.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}
        </Panel>
    );
}
