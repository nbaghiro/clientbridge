import type { ListPageProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Empty } from "./Empty";
import { Icon } from "./Icon";
import type { NativeProps } from "./props";
import { SearchField } from "./SearchField";
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
    empty,
    footer,
    style,
}: NativeProps<ListPageProps<T, K>>) {
    const hasHeader =
        title !== undefined || summary !== undefined || action !== undefined || accessory;
    return (
        <View style={[styles.page, style]}>
            {hasHeader ? (
                <View style={styles.header}>
                    <View style={styles.headerText}>
                        {title !== undefined ? <Text style={styles.title}>{title}</Text> : null}
                        {summary !== undefined ? (
                            <Text style={styles.summary}>{summary}</Text>
                        ) : null}
                    </View>
                    <View style={styles.headerActions}>
                        {accessory}
                        {action !== undefined ? (
                            <Pressable
                                style={styles.action}
                                onPress={action.onPress}
                                accessibilityRole="button"
                                accessibilityLabel={action.label}
                            >
                                <Icon name="plus" size={16} color={c.accentInk} />
                                <Text style={styles.actionText}>{action.label}</Text>
                            </Pressable>
                        ) : null}
                    </View>
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
                data={rows}
                keyExtractor={rowKey}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    banner !== undefined || head !== undefined ? (
                        <>
                            {banner !== undefined ? (
                                <View style={styles.banner}>{banner}</View>
                            ) : null}
                            {head !== undefined ? <View style={styles.head}>{head}</View> : null}
                        </>
                    ) : null
                }
                ListFooterComponent={footer !== undefined ? <>{footer}</> : null}
                ListEmptyComponent={<Empty message={empty} />}
                renderItem={({ item }) =>
                    onRowPress !== undefined ? (
                        <Pressable
                            style={styles.row}
                            accessibilityRole="button"
                            onPress={() => {
                                onRowPress(item);
                            }}
                        >
                            {renderRow(item)}
                        </Pressable>
                    ) : (
                        <View style={styles.row}>{renderRow(item)}</View>
                    )
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    headerText: { flexShrink: 1 },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    summary: { color: c.muted, fontSize: 13, marginTop: 2 },
    action: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    actionText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    searchWrap: { marginHorizontal: 20, marginTop: 10, marginBottom: 8 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    head: { paddingTop: 8 },
    banner: { paddingTop: 4, paddingBottom: 8 },
    row: {
        paddingVertical: 11,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});
