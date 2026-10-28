import { type ListPageProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Empty } from "./Empty";
import { LoadFailed } from "./LoadFailed";
import { Icon } from "./Icon";
import { PageHeader } from "./PageHeader";
import type { NativeProps } from "./props";
import { SearchField } from "./SearchField";
import { Skeleton } from "./Skeleton";
import { Tabs } from "./Tabs";

const c = theme.colors;

export function ListPage<T, K extends string = string>({
    title,
    summary,
    action,
    accessory,
    segments,
    search,
    banner,
    head,
    rows,
    rowKey,
    renderRow,
    onRowPress,
    selectedKey,
    empty,
    state,
    onRetry,
    footer,
    style,
}: NativeProps<ListPageProps<T, K>>) {
    const actions =
        action !== undefined || accessory ? (
            <View style={styles.headerActions}>
                {accessory}
                {action !== undefined ? (
                    <Pressable
                        style={styles.action}
                        onPress={action.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={action.label}
                    >
                        <Icon name="plus" size={14} color={c.accentInk} />
                        <Text style={styles.actionText}>{action.label}</Text>
                    </Pressable>
                ) : null}
            </View>
        ) : undefined;
    return (
        <View style={[styles.page, style]}>
            {title !== undefined ? (
                <PageHeader
                    style={styles.header}
                    title={title}
                    subtitle={summary}
                    actions={actions}
                />
            ) : summary !== undefined || actions !== undefined ? (
                <View style={[styles.header, styles.bare]}>
                    <Text style={styles.summary}>{summary}</Text>
                    {actions}
                </View>
            ) : null}
            {segments !== undefined ? (
                <Tabs
                    variant="pill"
                    items={[...segments.items]}
                    active={segments.active}
                    onSelect={segments.onSelect}
                />
            ) : null}
            {search !== undefined ? (
                <View style={styles.searchWrap}>
                    <SearchField
                        value={search.value}
                        onChange={search.onChange}
                        placeholder={search.placeholder}
                    />
                </View>
            ) : null}
            <FlatList
                data={state === undefined ? rows : []}
                keyExtractor={rowKey}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    banner !== undefined || head !== undefined ? (
                        <>
                            {banner !== undefined ? (
                                <View style={styles.banner}>{banner}</View>
                            ) : null}
                            {head !== undefined ? (
                                <View style={styles.head}>
                                    {typeof head === "string" ? (
                                        <Text style={styles.headText}>{head}</Text>
                                    ) : (
                                        head
                                    )}
                                </View>
                            ) : null}
                        </>
                    ) : null
                }
                ListFooterComponent={footer !== undefined ? <>{footer}</> : null}
                ListEmptyComponent={
                    state === "loading" ? (
                        <Skeleton variant="row" count={4} label={strings.common.loading} />
                    ) : state === "error" ? (
                        <LoadFailed
                            message={strings.ui.listError}
                            body={strings.ui.listErrorBody}
                            onRetry={onRetry}
                        />
                    ) : typeof empty === "string" ? (
                        <Empty message={empty} />
                    ) : (
                        <Empty {...empty} />
                    )
                }
                renderItem={({ item, index }) =>
                    onRowPress !== undefined ? (
                        <Pressable
                            style={[
                                styles.row,
                                index === 0 && styles.first,
                                rowKey(item) === selectedKey && styles.selected,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: rowKey(item) === selectedKey }}
                            onPress={() => {
                                onRowPress(item);
                            }}
                        >
                            {renderRow(item)}
                        </Pressable>
                    ) : (
                        <View style={[styles.row, index === 0 && styles.first]}>
                            {renderRow(item)}
                        </View>
                    )
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
    bare: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    summary: { flexShrink: 1, color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
    action: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 11,
        paddingVertical: 6,
    },
    actionText: { color: c.accentInk, fontFamily: theme.fonts.ui, fontSize: 13, fontWeight: "600" },
    searchWrap: { marginHorizontal: 20, marginTop: 10, marginBottom: 8 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    head: { paddingTop: 8 },
    headText: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        paddingBottom: 4,
    },
    banner: { paddingTop: 4, paddingBottom: 8 },
    // Rows run edge to edge on the card colour, past the list's side padding.
    selected: { backgroundColor: c.accentWeak },
    row: {
        paddingVertical: 11,
        paddingHorizontal: 20,
        marginHorizontal: -20,
        backgroundColor: c.surface,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    first: { borderTopColor: c.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
});
