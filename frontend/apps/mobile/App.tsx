// App root: gates on auth, then wires PowerSync + tab navigation. op-sqlite is native → dev build.
import { PowerSyncContext } from "@powersync/react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TabBar } from "./src/components/TabBar";
import { getAccessToken, getTokens } from "./src/lib/auth";
import { connectPowerSync, db } from "./src/lib/powersync";
import { ClientsScreen } from "./src/screens/Clients";
import { HomeScreen } from "./src/screens/Home";
import { LoginScreen } from "./src/screens/Login";
import { CalendarScreen, InboxScreen } from "./src/screens/Placeholder";

const Tab = createBottomTabNavigator();

const navTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: theme.colors.bg },
};

export function App() {
    return (
        <SafeAreaProvider>
            <Root />
        </SafeAreaProvider>
    );
}

function Root() {
    const [authed, setAuthed] = useState<boolean | null>(null);

    useEffect(() => {
        void getTokens().then((t) => {
            setAuthed(t !== null);
        });
    }, []);

    useEffect(() => {
        if (authed) void connectPowerSync(getAccessToken);
    }, [authed]);

    if (authed === null) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }
    if (!authed) {
        return (
            <LoginScreen
                onSuccess={() => {
                    setAuthed(true);
                }}
            />
        );
    }
    return (
        <PowerSyncContext.Provider value={db}>
            <NavigationContainer theme={navTheme}>
                <Tab.Navigator
                    initialRouteName="Clients"
                    tabBar={(props) => <TabBar {...props} />}
                    screenOptions={{ headerShown: false }}
                >
                    <Tab.Screen name="Today" component={HomeScreen} />
                    <Tab.Screen name="Calendar" component={CalendarScreen} />
                    <Tab.Screen name="Clients" component={ClientsScreen} />
                    <Tab.Screen name="Inbox" component={InboxScreen} />
                </Tab.Navigator>
            </NavigationContainer>
        </PowerSyncContext.Provider>
    );
}
