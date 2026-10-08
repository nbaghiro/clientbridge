import {
    BRAND_COLOURS,
    PUBLIC_PROFILE_FIELDS,
    type BrandForm,
    bookingPageUrl,
    mediaUrl,
    strings,
    useBookingPreview,
    useBrandForm,
    useSetupChecklist,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Checkbox,
    Button,
    Checklist,
    Choice,
    CopyField,
    Empty,
    FactList,
    Field,
    Icon,
    LoadFailed,
    Modal,
    Notice,
    Skeleton,
    SwatchPicker,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { Image, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { api, apiBaseUrl } from "../lib/api";
import { bookUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const o = strings.business.getSetUp;

function Mark({ brand, logo, size }: { brand: BrandForm; logo: string | null; size: number }) {
    if (logo !== null) {
        return (
            <Image
                source={{ uri: logo }}
                style={[styles.logoImage, { width: size, height: size }]}
            />
        );
    }
    return (
        <View style={[styles.mark, { backgroundColor: brand.colour, width: size, height: size }]}>
            <Text style={[styles.markText, { fontSize: size * 0.36 }]}>
                {(brand.name || "B").charAt(0).toUpperCase()}
            </Text>
        </View>
    );
}

/** The booking page as a phone shows it, with the brand being edited. */
function BookingPreview({ brand, logo }: { brand: BrandForm; logo: string | null }) {
    const preview = useBookingPreview(3);
    const b = strings.publicBooking;
    return (
        <View accessibilityLabel={o.preview} style={styles.preview}>
            <View style={styles.bar}>
                <Icon name="lock" size={11} color={c.muted} />
                <Text style={styles.url} numberOfLines={1}>
                    {bookingPageUrl(bookUrl, brand.slug).replace(/^https?:\/\//, "")}
                </Text>
            </View>
            <View style={styles.head}>
                <Mark brand={brand} logo={logo} size={36} />
                <View style={styles.grow}>
                    <Text style={styles.name} numberOfLines={1}>
                        {brand.name}
                    </Text>
                    {brand.tagline !== "" ? (
                        <Text style={styles.tagline} numberOfLines={1}>
                            {brand.tagline}
                        </Text>
                    ) : null}
                </View>
                {preview.rating !== null ? (
                    <View style={styles.rating}>
                        <Icon name="star" size={12} color={c.inkSoft} />
                        <Text style={styles.ratingText}>{preview.rating}</Text>
                    </View>
                ) : null}
            </View>
            <View style={styles.previewBody}>
                <Text style={styles.stepTitle}>{b.chooseService}</Text>
                <Text style={styles.small}>{b.chooseServiceHint}</Text>
                <View style={styles.gap}>
                    {preview.services.length === 0 ? (
                        <Text style={styles.small}>{o.previewNoServices}</Text>
                    ) : (
                        <Choice
                            layout="tiles"
                            label={b.chooseService}
                            columns={2}
                            value={preview.selected}
                            onChange={preview.select}
                            options={preview.services}
                        />
                    )}
                </View>
                {preview.facts.length > 0 ? (
                    <View style={styles.summary}>
                        <Text style={styles.section}>{b.summary}</Text>
                        <FactList facts={preview.facts} label={b.summary} />
                    </View>
                ) : null}
                <Text style={styles.powered}>{b.poweredBy}</Text>
            </View>
        </View>
    );
}

function BrandSheet({ brand, onClose }: { brand: BrandForm; onClose: () => void }) {
    const logo = brand.logoFileId === "" ? null : mediaUrl(apiBaseUrl, brand.logoFileId);
    return (
        <Modal open onClose={onClose} size="xl">
            <Text style={styles.sheetTitle}>{o.brandTitle}</Text>
            <Text style={styles.small}>{o.brandBody}</Text>
            <View style={styles.logoRow}>
                <Mark brand={brand} logo={logo} size={40} />
                <Text style={[styles.small, styles.grow]}>{o.logoOnWeb}</Text>
            </View>
            <Field label={o.colour}>
                <SwatchPicker
                    label={o.colour}
                    colours={BRAND_COLOURS}
                    value={brand.colour}
                    onChange={brand.setColour}
                />
            </Field>
            <TextField
                label={o.tagline}
                value={brand.tagline}
                onChange={brand.setTagline}
                placeholder={o.taglinePlaceholder}
                maxLength={60}
                optional
                surface="surface"
            />
            <View style={{ gap: 12 }}>
                <Text style={styles.sheetTitle}>{o.profileTitle}</Text>
                <Text>{o.profileHint}</Text>
                {PUBLIC_PROFILE_FIELDS.map((field) =>
                    field.multiline ? (
                        <TextField
                            multiline
                            key={field.key}
                            label={field.label}
                            value={brand.profile[field.key]}
                            onChange={(value) => {
                                brand.setProfile(field.key, value);
                            }}
                        />
                    ) : (
                        <TextField
                            key={field.key}
                            label={field.label}
                            type={field.numeric ? "number" : "text"}
                            value={brand.profile[field.key]}
                            onChange={(value) => {
                                brand.setProfile(field.key, value);
                            }}
                        />
                    ),
                )}
                <Text>{o.publicTeamHint}</Text>
                {brand.publicTeam.map((person) => (
                    <Checkbox
                        key={person.id}
                        label={person.name}
                        value={person.selected}
                        onChange={(selected) => {
                            brand.setPublicTeam(person.id, selected);
                        }}
                    />
                ))}
            </View>
            <View style={styles.gap}>
                <BookingPreview brand={brand} logo={logo} />
            </View>
            {brand.error !== null ? <Notice tone="danger">{brand.error}</Notice> : null}
            {brand.saved ? <Notice tone="success">{o.saved}</Notice> : null}
            <View style={styles.gap}>
                <Button size="lg" full busy={brand.busy} onPress={brand.submit}>
                    {brand.busy ? o.saving : o.save}
                </Button>
            </View>
        </Modal>
    );
}

/** The Setup home on a phone: the checklist, the booking link and the brand sheet. */
export function GetSetUpScreen() {
    const brand = useBrandForm(api);
    const list = useSetupChecklist(api, bookUrl);
    const open = useOpenLink();
    const [editing, setEditing] = useState(false);
    const pct = list.done / list.total;

    if (list.load.state === "loading") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <Skeleton variant="row" count={7} label={o.loading} />
                </View>
            </View>
        );
    }
    if (list.load.state === "error") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <LoadFailed
                        variant="card"
                        message={o.loadError}
                        onRetry={list.load.retry}
                        retrying={list.load.retrying}
                    />
                </View>
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.body}>{o.body}</Text>
                {list.hideError !== null ? <Notice tone="danger">{list.hideError}</Notice> : null}
                {list.dismissed ? (
                    <Empty
                        variant="card"
                        icon="checkCircle"
                        message={o.hiddenTitle}
                        body={o.hiddenBody(list.total - list.done)}
                        actions={
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    list.setHidden(false);
                                }}
                            >
                                {o.showList}
                            </Button>
                        }
                    />
                ) : (
                    <>
                        <View style={styles.progressRow}>
                            <View
                                style={styles.track}
                                accessibilityRole="progressbar"
                                accessibilityLabel={o.progress(list.done, list.total)}
                            >
                                <View
                                    style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]}
                                />
                            </View>
                            <Text style={styles.progressText}>
                                {o.progress(list.done, list.total)}
                            </Text>
                        </View>
                        <View style={styles.card}>
                            <Checklist
                                label={o.title}
                                items={list.steps.map((t) => ({
                                    key: t.key,
                                    label: t.label,
                                    hint: t.hint,
                                    done: t.done,
                                    action: {
                                        label: t.action,
                                        onPress: () => {
                                            if (t.key === "brand") setEditing(true);
                                            else open(t.target);
                                        },
                                    },
                                }))}
                            />
                        </View>
                    </>
                )}
                <View style={[styles.card, styles.share]}>
                    <View style={styles.shareHead}>
                        <Text style={styles.shareTitle}>{o.shareTitle}</Text>
                        {list.live ? <Badge label={o.live} intent="success" /> : null}
                    </View>
                    <Text style={styles.small}>{list.live ? o.shareBody : o.notLive}</Text>
                    <CopyField
                        label={o.shareTitle}
                        value={list.bookingUrl}
                        copied={false}
                        copyLabel={o.share}
                        onCopy={() => {
                            Share.share({ message: list.bookingUrl }).catch(() => undefined);
                        }}
                    />
                </View>
                <Button
                    variant="outline"
                    icon="image"
                    onPress={() => {
                        setEditing(true);
                    }}
                >
                    {o.brandTitle}
                </Button>
                {list.dismissed ? null : (
                    <Button
                        variant="quiet"
                        onPress={() => {
                            list.setHidden(true);
                        }}
                    >
                        {o.hide}
                    </Button>
                )}
            </ScrollView>
            {editing ? (
                <BrandSheet
                    brand={brand}
                    onClose={() => {
                        setEditing(false);
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 32, gap: 14 },
    body: { color: c.muted, fontSize: 14, lineHeight: 20 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.accent },
    progressText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
    },
    share: { paddingVertical: 14, gap: 10 },
    shareHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    shareTitle: { color: c.ink, fontSize: 16, fontWeight: "700" },
    small: { color: c.muted, fontSize: 13, lineHeight: 18 },
    sheetTitle: { color: c.ink, fontSize: 20, fontWeight: "700", marginBottom: 4 },
    logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
    logoImage: { borderRadius: 10, backgroundColor: c.surface },
    gap: { marginTop: 16 },
    grow: { flex: 1, minWidth: 0 },
    preview: {
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    bar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: c.head,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
    },
    url: { color: c.muted, fontSize: 11, fontFamily: "monospace", flexShrink: 1 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    name: { color: c.ink, fontSize: 16, fontWeight: "700" },
    tagline: { color: c.muted, fontSize: 12, marginTop: 1 },
    rating: { flexDirection: "row", alignItems: "center", gap: 4 },
    ratingText: { color: c.inkSoft, fontSize: 12 },
    previewBody: {
        padding: 14,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: c.bg,
    },
    stepTitle: { color: c.ink, fontSize: 18, fontWeight: "700", marginBottom: 2 },
    summary: {
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    section: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: 8,
    },
    powered: { color: c.muted, fontSize: 11, textAlign: "center", marginTop: 14 },
    mark: { borderRadius: 10, alignItems: "center", justifyContent: "center" },
    markText: { color: c.surface, fontWeight: "700" },
});
