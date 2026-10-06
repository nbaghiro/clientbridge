import { theme } from "@clientbridge/tokens/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable } from "react-native";
import { Icon } from "@clientbridge/ui";

import type { RootStackParamList } from "../navigation";

export function InboxButton() {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    return (
        <Pressable
            hitSlop={10}
            onPress={() => {
                nav.navigate("Inbox");
            }}
        >
            <Icon name="inbox" size={22} color={theme.colors.inkSoft} />
        </Pressable>
    );
}
