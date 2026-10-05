import { strings, useBusinessId } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { PowerSyncContext, useStatus } from "@powersync/react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureStripe } from "@clientbridge/ui";

import { StripeAppProvider } from "./src/components/Stripe";
import { TabBar } from "./src/components/TabBar";
import { api, onSignedOut } from "./src/lib/api";
import { clearTokens, getTokens } from "./src/lib/auth";
import { stripePublishableKey } from "./src/lib/config";
import { connectPowerSync, db, signOut } from "./src/lib/powersync";
import { registerForPush } from "./src/lib/push";
import type { RootStackParamList, TabParamList } from "./src/navigation";
import { CalendarScreen } from "./src/screens/Calendar";
import { CatalogScreen } from "./src/screens/Catalog";
import { ClientsScreen } from "./src/screens/Clients";
import { InboxScreen } from "./src/screens/Inbox";
import { LoginScreen } from "./src/screens/Login";
import { OnboardingScreen } from "./src/screens/Onboarding";
import { PaymentsScreen } from "./src/screens/Payments";
import { GettingPaidScreen } from "./src/screens/GettingPaid";
import { BusinessScreen, SetupScreen, TeamHoursScreen } from "./src/screens/Setup";
import { TodayScreen } from "./src/screens/Today";

configureStripe(stripePublishableKey);

const Tab = createBottomTabNavigator<TabParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: theme.colors.bg },
};

function Tabs() {
    return (
        <Tab.Navigator
            initialRouteName="Today"
            tabBar={(props) => <TabBar {...props} />}
            screenOptions={{ headerShown: false }}
        >
            <Tab.Screen name="Today" component={TodayScreen} />
            <Tab.Screen name="Schedule" component={CalendarScreen} />
            <Tab.Screen name="Clients" component={ClientsScreen} />
            <Tab.Screen name="Payments" component={PaymentsScreen} />
        </Tab.Navigator>
    );
}

export function App() {
    return (
        <SafeAreaProvider>
            <Root />
        </SafeAreaProvider>
    );
}

function Root() {
    const [authed, setAuthed] = useState<boolean | null>(null);

    const handleSignOut = useCallback(async (): Promise<void> => {
        await clearTokens();
        await signOut();
        setAuthed(false);
    }, []);

    useEffect(() => {
        onSignedOut(() => {
            handleSignOut().catch(() => undefined);
        });
    }, [handleSignOut]);

    useEffect(() => {
        getTokens()
            .then((t) => {
                setAuthed(t !== null);
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (authed) {
            connectPowerSync(api.authFetch).catch(() => undefined);
            registerForPush().catch(() => undefined);
        }
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
            <AuthedApp
                onSignOut={() => {
                    handleSignOut().catch(() => undefined);
                }}
            />
        </PowerSyncContext.Provider>
    );
}

/** Holds a fresh sign-up in onboarding until their business has synced. */
function AuthedApp({ onSignOut }: { onSignOut: () => void }) {
    const hasSynced = useStatus().hasSynced ?? false;
    const businessId = useBusinessId();

    if (businessId === null) {
        if (!hasSynced) {
            return (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator />
                </View>
            );
        }
        return <OnboardingScreen onSignOut={onSignOut} />;
    }

    return (
        <StripeAppProvider>
            <NavigationContainer theme={navTheme}>
                <RootStack.Navigator screenOptions={{ headerShown: false }}>
                    <RootStack.Screen name="Tabs" component={Tabs} />
                    <RootStack.Group
                        screenOptions={{
                            headerShown: true,
                            headerStyle: { backgroundColor: theme.colors.surface },
                            headerTintColor: theme.colors.ink,
                            headerShadowVisible: false,
                            headerBackTitle: "Back",
                        }}
                    >
                        <RootStack.Screen
                            name="Inbox"
                            component={InboxScreen}
                            options={{ title: strings.navigation.inbox }}
                        />
                        <RootStack.Screen
                            name="Setup"
                            component={SetupScreen}
                            options={{ title: strings.navigation.setup }}
                        />
                        <RootStack.Screen
                            name="Business"
                            component={BusinessScreen}
                            options={{ title: strings.navigation.setupSections.business }}
                        />
                        <RootStack.Screen
                            name="Services"
                            component={CatalogScreen}
                            options={{ title: strings.navigation.setupSections.services }}
                        />
                        <RootStack.Screen
                            name="Team"
                            component={TeamHoursScreen}
                            options={{ title: strings.navigation.setupSections.team }}
                        />
                        <RootStack.Screen
                            name="GettingPaid"
                            component={GettingPaidScreen}
                            options={{ title: strings.navigation.setupSections.gettingPaid }}
                        />
                    </RootStack.Group>
                </RootStack.Navigator>
            </NavigationContainer>
        </StripeAppProvider>
    );
}
