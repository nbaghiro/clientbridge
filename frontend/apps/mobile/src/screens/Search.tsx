import {
    type SearchHit,
    type SearchKind,
    highlight,
    strings,
    useGlobalSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    SearchField,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { useNavigation } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.search;

function Highlighted({ text, q, style }: { text: string; q: string; style: object }) {
    return (
        <Text style={style} numberOfLines={1}>
            {highlight(text, q).map((p, i) => (
                <Text key={i} style={p.match ? styles.match : undefined}>
                    {p.text}
                </Text>
            ))}
        </Text>
    );
}

function HitRow({ hit, q, onPress }: { hit: SearchHit; q: string; onPress: () => void }) {
    return (
        <ListRow
            density="compact"
            icon={hit.icon}
            intent={hit.kind === "actions" ? "accent" : "neutral"}
            leading={
                hit.color !== null && hit.kind !== "actions" ? (
                    <View style={styles.swatch}>
                        <View style={[styles.dot, { backgroundColor: hit.color }]} />
                    </View>
                ) : undefined
            }
            label={`${hit.title}, ${hit.detail}`}
            title={<Highlighted text={hit.title} q={q} style={styles.title} />}
            detail={
                <Highlighted
                    text={hit.detail}
                    q={hit.kind === "actions" ? "" : q}
                    style={styles.detail}
                />
            }
            meta={
                hit.meta !== null && hit.metaIntent !== null ? (
                    <StatusPill status={hit.meta} intent={hit.metaIntent} />
                ) : hit.meta !== null && hit.kind !== "actions" ? (
                    <Text style={styles.price}>{hit.meta}</Text>
                ) : undefined
            }
            onPress={onPress}
        />
    );
}

/** Full-screen search over this device's replica, the phone form of the ⌘K palette. */
export function SearchScreen() {
    const search = useGlobalSearch(useViewer());
    const openLink = useOpenLink();
    const nav = useNavigation();
    const open = (hit: SearchHit): void => {
        search.remember(search.q);
        openLink(hit.target, hit.refId);
    };
    const scopes = search.scopes.map((k) => ({
        key: k.key,
        label: k.count === null ? k.label : `${k.label} ${String(k.count)}`,
        disabled: k.count === 0,
    }));
    const q = search.q.trim();

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.top}>
                <SearchField
                    value={search.q}
                    onChange={search.setQ}
                    placeholder={s.placeholder}
                    autoFocus
                    trailing={
                        <Button
                            variant="link"
                            onPress={() => {
                                nav.goBack();
                            }}
                        >
                            {s.cancel}
                        </Button>
                    }
                />
            </View>
            <View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.scopes}
                >
                    <Choice<SearchKind | "all">
                        options={scopes}
                        value={search.scope}
                        onChange={search.setScope}
                        label={s.filters}
                    />
                </ScrollView>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {search.load.state === "loading" ? (
                    <View style={styles.card}>
                        <Skeleton variant="row" count={5} label={s.loading} />
                    </View>
                ) : search.load.state === "error" ? (
                    <LoadFailed
                        message={s.loadError}
                        body={s.loadErrorBody}
                        onRetry={search.load.retry}
                        retrying={search.load.retrying}
                    />
                ) : q === "" ? (
                    <>
                        {search.load.state === "empty" && search.recent.length === 0 ? (
                            <Empty icon="search" message={s.nothingYet} body={s.nothingYetBody} />
                        ) : null}
                        {search.recent.length > 0 ? (
                            <>
                                <View style={styles.groupHead}>
                                    <Text style={styles.head}>{s.recent}</Text>
                                    <Button size="sm" variant="link" onPress={search.clearRecent}>
                                        {s.clearRecent}
                                    </Button>
                                </View>
                                <View style={styles.card}>
                                    {search.recent.map((r, i) => (
                                        <View key={r} style={i > 0 ? styles.divider : undefined}>
                                            <ListRow
                                                density="compact"
                                                icon="history"
                                                title={r}
                                                label={s.recentSearch(r)}
                                                onPress={() => {
                                                    search.setQ(r);
                                                }}
                                                meta={
                                                    <Icon
                                                        name="chevron"
                                                        size={15}
                                                        color={c.muted}
                                                    />
                                                }
                                            />
                                        </View>
                                    ))}
                                </View>
                            </>
                        ) : null}
                        <Text style={styles.note}>{s.offline}</Text>
                    </>
                ) : search.total === 0 ? (
                    <>
                        <Empty icon="search" message={s.noResults(q)} body={s.noResultsHint} />
                        {search.flat.map((hit) => (
                            <View key={hit.id} style={styles.card}>
                                <HitRow
                                    hit={hit}
                                    q={search.q}
                                    onPress={() => {
                                        open(hit);
                                    }}
                                />
                            </View>
                        ))}
                    </>
                ) : (
                    search.groups.map((g) => (
                        <View key={g.kind}>
                            <View style={styles.groupHead}>
                                <Text style={styles.head}>{g.label}</Text>
                                {g.total > g.hits.length ? (
                                    <Button
                                        size="sm"
                                        variant="link"
                                        onPress={() => {
                                            search.setScope(g.kind);
                                        }}
                                    >
                                        {s.seeAll(g.total)}
                                    </Button>
                                ) : null}
                            </View>
                            <View style={styles.card}>
                                {g.hits.map((hit, i) => (
                                    <View key={hit.id} style={i > 0 ? styles.divider : undefined}>
                                        <HitRow
                                            hit={hit}
                                            q={search.q}
                                            onPress={() => {
                                                open(hit);
                                            }}
                                        />
                                    </View>
                                ))}
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    top: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    scopes: { paddingHorizontal: 16, paddingBottom: 8 },
    body: { paddingHorizontal: 16, paddingBottom: 40 },
    head: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 14,
        marginBottom: 8,
        marginLeft: 4,
    },
    groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    card: {
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
        marginTop: 8,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    note: { color: c.muted, fontSize: 12.5, marginTop: 20, textAlign: "center", lineHeight: 18 },
    match: { color: c.accentStrong, fontWeight: "700", backgroundColor: c.accentWeak },
    title: { color: c.ink, fontSize: 15, fontWeight: "500" },
    detail: { color: c.muted, fontSize: 13, marginTop: 2 },
    price: { color: c.ink, fontSize: 14, fontWeight: "600" },
    swatch: {
        width: 32,
        height: 32,
        borderRadius: theme.radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.surface2,
    },
    dot: { width: 12, height: 12, borderRadius: 6 },
});
