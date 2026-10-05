import { theme } from "@clientbridge/tokens/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable } from "react-native";

import type { RootStackParamList } from "../navigation";
import { IconInbox } from "./Icons";

export function InboxButton() {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    return (
        <Pressable
            hitSlop={10}
            onPress={() => {
                nav.navigate("Inbox");
            }}
        >
            <IconInbox size={22} color={theme.colors.inkSoft} />
        </Pressable>
    );
}
