import {
    BRAND_COLOURS,
    PICKUP_FIELDS,
    PUBLIC_PROFILE_FIELDS,
    type BrandForm,
    bareUrl,
    bookingPageUrl,
    mediaUrl,
    coverTarget,
    logoTarget,
    useFileUpload,
    useAsyncAction,
    strings,
    useBookingPreview,
    useBrandForm,
    useSetupChecklist,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Avatar,
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
    Panel,
    SheetHeader,
    Skeleton,
    SwatchPicker,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Image, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { api, apiBaseUrl } from "../lib/api";
import { bookUrl, pageUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const o = strings.business.getSetUp;

/** The booking page as a phone shows it, with the brand being edited. */
function BookingPreview({ brand, logo }: { brand: BrandForm; logo: string | null }) {
    const preview = useBookingPreview(3);
    const b = strings.publicBooking;
    return (
        <View accessibilityLabel={o.preview} style={styles.preview}>
            <View style={styles.bar}>
                <Icon name="lock" size={11} color={c.muted} />
                <Text style={styles.url} numberOfLines={1}>
                    {bareUrl(bookingPageUrl(bookUrl, brand.slug))}
                </Text>
            </View>
            <View style={styles.head}>
                <Avatar name={brand.name} src={logo} variant="mark" color={brand.colour} />
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
                <Text style={styles.powered}>{strings.publicLanding.poweredBy}</Text>
            </View>
        </View>
    );
}

function BrandSheet({ brand, onClose }: { brand: BrandForm; onClose: () => void }) {
    const upload = useFileUpload(api, (id) => {
        brand.setProfile("cover_url", mediaUrl(apiBaseUrl, id) ?? "");
    });
    const logoUpload = useFileUpload(api, brand.setLogoFileId);
    const picker = useAsyncAction();
    const pickImage = (kind: "logo" | "cover"): void => {
        picker.run(
            async () => {
                const result = await launchImageLibraryAsync({
                    mediaTypes: ["images"],
                    quality: 0.85,
                });
                const asset = result.assets?.[0];
                if (!asset || !brand.businessId) return;
                const blob = await (await fetch(asset.uri)).blob();
                const target = kind === "logo" ? logoTarget : coverTarget;
                const flow = kind === "logo" ? logoUpload : upload;
                flow.upload(
                    blob,
                    target(brand.businessId),
                    asset.mimeType ?? "image/jpeg",
                    asset.fileSize,
                );
            },
            { errorMessage: strings.common.fileUploadError },
        );
    };

    const logo = brand.logoFileId === "" ? null : mediaUrl(apiBaseUrl, brand.logoFileId);
    return (
        <Modal open onClose={onClose} size="xl">
            <View style={styles.brandSections}>
                <View style={styles.stack}>
                    <SheetHeader title={o.brandTitle} onClose={onClose} />
                    <Text style={styles.small}>{o.brandBody}</Text>
                </View>
                <View style={styles.logoRow}>
                    <Avatar
                        name={brand.name}
                        src={logo}
                        variant="mark"
                        color={brand.colour}
                        size="lg"
                    />
                    <View style={[styles.stack, styles.grow]}>
                        <Text style={styles.section}>{o.logo}</Text>
                        <Text style={styles.small}>{o.logoHint}</Text>
                        <Button
                            size="sm"
                            variant="outline"
                            busy={logoUpload.busy || picker.busy}
                            disabled={upload.busy}
                            onPress={() => {
                                pickImage("logo");
                            }}
                        >
                            {logo !== null ? strings.files.replaceLogo : strings.files.uploadLogo}
                        </Button>
                    </View>
                </View>
                <Field label={o.coverPhoto}>
                    <View style={styles.stack}>
                        {brand.profile.cover_url ? (
                            <Image
                                source={{ uri: brand.profile.cover_url }}
                                style={{
                                    width: "100%",
                                    aspectRatio: 3,
                                    borderRadius: theme.radius,
                                }}
                            />
                        ) : (
                            <View
                                style={{
                                    height: 90,
                                    backgroundColor: brand.colour,
                                    borderRadius: theme.radius,
                                }}
                            />
                        )}
                        <Text style={styles.small}>{o.coverHint}</Text>
                        <View
                            style={{
                                flexDirection: "row",
                                flexWrap: "wrap",
                                alignItems: "center",
                                gap: 12,
                            }}
                        >
                            <Button
                                style={{ alignSelf: "center" }}
                                size="sm"
                                variant="outline"
                                busy={upload.busy || picker.busy}
                                disabled={logoUpload.busy}
                                onPress={() => {
                                    pickImage("cover");
                                }}
                            >
                                {brand.profile.cover_url ? o.replaceCover : o.uploadCover}
                            </Button>
                            {brand.profile.cover_url ? (
                                <Button
                                    style={{ alignSelf: "center" }}
                                    size="sm"
                                    variant="link"
                                    onPress={() => {
                                        brand.setProfile("cover_url", "");
                                    }}
                                >
                                    {o.removeCover}
                                </Button>
                            ) : null}
                        </View>
                        {upload.error || logoUpload.error || picker.error ? (
                            <Notice tone="danger">
                                {upload.error ?? logoUpload.error ?? picker.error}
                            </Notice>
                        ) : null}
                    </View>
                </Field>
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
                <View style={styles.profileSection}>
                    <Text style={styles.sectionTitle}>{o.profileTitle}</Text>
                    <Text style={styles.small}>{o.profileHint}</Text>
                    {PUBLIC_PROFILE_FIELDS.map((field) => (
                        <TextField
                            key={field.key}
                            multiline={field.multiline}
                            label={field.label}
                            value={brand.profile[field.key]}
                            onChange={(value) => {
                                brand.setProfile(field.key, value);
                            }}
                        />
                    ))}
                    {PICKUP_FIELDS.map((field) => (
                        <TextField
                            key={field.key}
                            label={field.label}
                            type="number"
                            value={brand.profile[field.key]}
                            onChange={(value) => {
                                brand.setProfile(field.key, value);
                            }}
                        />
                    ))}
                    <Text style={styles.small}>{o.publicTeamHint}</Text>
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
                    <Button
                        size="lg"
                        full
                        busy={brand.busy}
                        disabled={upload.busy || logoUpload.busy || picker.busy}
                        onPress={brand.submit}
                    >
                        {brand.busy ? o.saving : o.save}
                    </Button>
                </View>
            </View>
        </Modal>
    );
}

/** The Setup home on a phone: the checklist, the booking link and the brand sheet. */
export function GetSetUpScreen() {
    const brand = useBrandForm(api);
    const list = useSetupChecklist(api, pageUrl);
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
                        <Panel flush style={styles.card}>
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
                        </Panel>
                    </>
                )}
                <Panel
                    title={o.shareTitle}
                    actions={
                        list.live ? (
                            <Badge
                                style={{ alignSelf: "center" }}
                                label={o.live}
                                intent="success"
                            />
                        ) : undefined
                    }
                    style={styles.share}
                >
                    <Text style={styles.small}>{list.live ? o.shareBody : o.notLive}</Text>
                    <CopyField
                        label={o.shareTitle}
                        value={list.pageUrl}
                        copied={false}
                        copyLabel={o.share}
                        onCopy={() => {
                            Share.share({ message: list.pageUrl }).catch(() => undefined);
                        }}
                    />
                </Panel>
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
    screen: { flex: 1 },
    content: { padding: 16, paddingBottom: 32, gap: 14 },
    body: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.accent },
    progressText: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 13, fontWeight: "600" },
    card: { paddingHorizontal: 14 },
    share: { gap: 10 },
    small: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 },
    sectionTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
        marginBottom: 4,
    },
    logoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    brandSections: { gap: 16 },
    stack: { gap: 8 },
    profileSection: {
        gap: 12,
        borderTopWidth: theme.borderWidth,
        borderTopColor: c.border,
        paddingTop: 20,
    },
    gap: { marginTop: 16 },
    grow: { flex: 1, minWidth: 0 },
    preview: {
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: theme.borderWidth,
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
        borderBottomWidth: theme.borderWidth,
        borderBottomColor: c.border,
    },
    url: { color: c.muted, fontSize: 11, fontFamily: theme.fonts.mono, flexShrink: 1 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    name: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 16, fontWeight: "700" },
    tagline: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 1 },
    previewBody: {
        padding: 14,
        borderTopWidth: theme.borderWidth,
        borderTopColor: c.border,
        backgroundColor: c.bg,
    },
    stepTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
        marginBottom: 2,
    },
    summary: {
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    section: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: 8,
    },
    powered: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        textAlign: "center",
        marginTop: 14,
    },
});
