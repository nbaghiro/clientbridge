import {
    type ItemTaxClass,
    type ItemTaxClasses,
    type TaxSettingsForm,
    FILING_FREQUENCIES,
    PROVINCES,
    TAX_CLASS_KEYS,
    formatDate,
    itemPriceLabel,
    strings,
    taxClassLabel,
    taxExample,
    taxExampleTitle,
    useItemTaxClasses,
    useTaxSettingsForm,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Checkbox,
    Choice,
    Empty,
    Field,
    Icon,
    LoadFailed,
    Money,
    Notice,
    Panel,
    Select,
    Skeleton,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.taxes;
const provinceName = (code: string): string => PROVINCES.find((p) => p.code === code)?.name ?? code;
const grid =
    "grid grid-cols-[20px_minmax(0,2fr)_84px_150px] items-center gap-3 xl:grid-cols-[20px_minmax(0,2fr)_minmax(0,0.8fr)_84px_150px]";

function classOptions(province: string | null) {
    return TAX_CLASS_KEYS.map((k) => ({ key: k, label: taxClassLabel(k, province) }));
}

function WorkedExample({ form }: { form: TaxSettingsForm }) {
    const collect = form.registration === "registered";
    return (
        <Panel title={s.exampleTitle}>
            <div className="grid gap-3">
                {TAX_CLASS_KEYS.map((cls) => {
                    const ex = taxExample(cls, form.province, collect);
                    return (
                        <div key={cls} className="rounded-md border border-line bg-bg p-3">
                            <p className="text-xs font-semibold text-ink-soft">
                                {taxExampleTitle(cls, form.province)}
                            </p>
                            <dl className="mt-2 space-y-1 text-xs">
                                <div className="flex justify-between text-muted">
                                    <dt>{s.colPrice}</dt>
                                    <dd>
                                        <Money cents={10000} tone="muted" />
                                    </dd>
                                </div>
                                {ex.lines.map((l) => (
                                    <div key={l.label} className="flex justify-between text-muted">
                                        <dt>{l.label}</dt>
                                        <dd>
                                            <Money cents={l.cents} tone="muted" />
                                        </dd>
                                    </div>
                                ))}
                                <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink">
                                    <dt>{s.total}</dt>
                                    <dd>
                                        <Money cents={ex.totalCents} strong />
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    );
                })}
            </div>
        </Panel>
    );
}

function FilingCard({ form }: { form: TaxSettingsForm }) {
    const open = useOpenLink();
    return (
        <Panel>
            <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-weak text-accent">
                    <Icon name="calendar" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted">{s.filingTitle}</p>
                    <p className="font-display text-lg font-bold text-ink">
                        {s.filingDue(formatDate(form.filing.due))}
                    </p>
                    <p className="text-xs text-muted">
                        {s.filingPeriod(formatDate(form.filing.from), formatDate(form.filing.to))}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-muted">{s.filingCollected}</p>
                    <p className="text-base font-semibold">
                        <Money cents={form.filing.collectedCents} />
                    </p>
                </div>
            </div>
            <div className="mt-3 border-t border-line-soft pt-3">
                <Button
                    size="sm"
                    variant="link"
                    onPress={() => {
                        open("reports");
                    }}
                >
                    {s.openReport}
                </Button>
            </div>
        </Panel>
    );
}

function ItemClasses({ items, province }: { items: ItemTaxClasses; province: string | null }) {
    const open = useOpenLink();
    const n = items.selected.length;
    const options = classOptions(province);
    return (
        <Panel flush title={s.classesTitle} subtitle={s.classesBody}>
            {items.load.state === "loading" ? (
                <Skeleton variant="row" count={4} label={s.loading} />
            ) : null}
            {items.load.state === "empty" ? (
                <Empty
                    icon="tag"
                    message={s.noItemsTitle}
                    body={s.noItemsBody}
                    actions={
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                open("catalog");
                            }}
                        >
                            {s.addItems}
                        </Button>
                    }
                />
            ) : null}
            {n > 0 ? (
                <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-weak px-4 py-2.5">
                    <span className="text-sm font-semibold text-accent-strong">
                        {s.selected(n)}
                    </span>
                    <span className="text-sm text-ink-soft">{s.setTo}</span>
                    <Choice<ItemTaxClass>
                        layout="segmented"
                        label={s.setTo}
                        value={null}
                        onChange={(cls) => {
                            items.setClass(items.selected, cls);
                        }}
                        options={options}
                    />
                    <Button size="sm" variant="quiet" onPress={items.clearSelection}>
                        {s.clear}
                    </Button>
                </div>
            ) : null}
            {items.items.length > 0 ? (
                <div
                    className={`${grid} border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted`}
                >
                    <Checkbox
                        label={s.selectAll}
                        hideLabel
                        value={items.allSelected}
                        mixed={n > 0 && !items.allSelected}
                        onChange={items.toggleAll}
                    />
                    <span>{s.colItem}</span>
                    <span className="hidden xl:block">{s.colKind}</span>
                    <span className="text-right">{s.colPrice}</span>
                    <span>{s.colClass}</span>
                </div>
            ) : null}
            <ul className="divide-y divide-line-soft">
                {items.items.map((it) => (
                    <li
                        key={it.id}
                        className={`${grid} px-4 py-2 ${items.selected.includes(it.id) ? "bg-accent-weak/50" : ""}`}
                    >
                        <Checkbox
                            label={s.selectItem(it.name)}
                            hideLabel
                            value={items.selected.includes(it.id)}
                            onChange={() => {
                                items.toggle(it.id);
                            }}
                        />
                        <span className="truncate text-sm font-medium text-ink">{it.name}</span>
                        <span className="hidden truncate text-sm text-ink-soft xl:block">
                            {s.kinds[it.kind] ?? it.kind}
                        </span>
                        <span className="whitespace-nowrap text-right text-sm text-ink-soft">
                            {itemPriceLabel(it)}
                        </span>
                        <Select<ItemTaxClass>
                            name={s.classFor(it.name)}
                            value={it.tax_class}
                            onChange={(cls) => {
                                items.setClass([it.id], cls);
                            }}
                            options={options}
                            size="sm"
                        />
                    </li>
                ))}
            </ul>
            {items.error !== null ? (
                <div className="px-4 py-3">
                    <Notice tone="danger">{items.error}</Notice>
                </div>
            ) : null}
        </Panel>
    );
}

export function Taxes() {
    const form = useTaxSettingsForm(api, provinceName);
    const items = useItemTaxClasses(api);
    const registered = form.registration === "registered";

    return (
        <div>
            <p className="mt-1 text-sm text-muted">{s.subtitle}</p>
            {form.load.state === "error" ? (
                <div className="mt-6">
                    <Panel flush>
                        <LoadFailed
                            message={s.loadError}
                            onRetry={form.load.retry}
                            retrying={form.load.retrying}
                        />
                    </Panel>
                </div>
            ) : form.load.state === "loading" ? (
                <div className="mt-6 space-y-6">
                    <Panel flush>
                        <Skeleton variant="line" count={5} label={s.loading} />
                    </Panel>
                </div>
            ) : (
                <>
                    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
                        <div className="self-start">
                            <Panel>
                                <form
                                    noValidate
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        form.submit();
                                    }}
                                    className="space-y-4"
                                >
                                    <Field label={s.registeredQ}>
                                        <Choice
                                            layout="cards"
                                            label={s.registeredQ}
                                            value={form.registration}
                                            onChange={form.setRegistration}
                                            options={[
                                                {
                                                    key: "registered",
                                                    label: s.regYes,
                                                    hint: s.regYesHint,
                                                },
                                                {
                                                    key: "small",
                                                    label: s.regSmall,
                                                    hint: s.regSmallHint,
                                                },
                                            ]}
                                        />
                                    </Field>
                                    {registered ? null : (
                                        <Notice tone="info" banner>
                                            {s.offNotice}
                                        </Notice>
                                    )}
                                    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2.5">
                                        <div>
                                            <p className="text-xs text-muted">{s.province}</p>
                                            <p className="text-sm font-medium text-ink">
                                                {form.provinceName}
                                            </p>
                                        </div>
                                        <div className="flex gap-1.5">
                                            {form.taxLines.map((l) => (
                                                <Badge
                                                    key={l.label}
                                                    label={l.label}
                                                    intent="neutral"
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <TextField
                                        label={s.gst}
                                        hint={s.gstHint}
                                        value={form.gst}
                                        onChange={form.setGst}
                                        error={form.fieldErrors.gst}
                                        disabled={!registered}
                                    />
                                    {form.hasPst ? (
                                        <TextField
                                            label={s.pst}
                                            hint={s.pstHint}
                                            value={form.pst}
                                            onChange={form.setPst}
                                            error={form.fieldErrors.pst}
                                            disabled={!registered}
                                            optional
                                        />
                                    ) : null}
                                    <Select
                                        label={s.frequency}
                                        value={form.frequency}
                                        onChange={form.setFrequency}
                                        options={FILING_FREQUENCIES.map((k) => ({
                                            key: k,
                                            label: s.freq[k],
                                        }))}
                                    />
                                    {form.error !== null ? (
                                        <Notice tone="danger">{form.error}</Notice>
                                    ) : null}
                                    <div className="flex items-center gap-3">
                                        <Button submit busy={form.busy} disabled={!form.dirty}>
                                            {form.busy ? s.saving : s.save}
                                        </Button>
                                        {form.saved ? (
                                            <Notice tone="success">{s.saved}</Notice>
                                        ) : null}
                                    </div>
                                </form>
                            </Panel>
                        </div>
                        <div className="space-y-6">
                            {registered ? <FilingCard form={form} /> : null}
                            <WorkedExample form={form} />
                        </div>
                    </div>
                    <div className="mt-8">
                        <ItemClasses items={items} province={form.province} />
                    </div>
                </>
            )}
        </div>
    );
}
