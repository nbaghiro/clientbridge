import { useBusinessId } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { PowerSyncContext, useStatus } from "@powersync/react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { StripeAppProvider } from "./src/components/stripe";
import { TabBar } from "./src/components/TabBar";
import { api, onSignedOut } from "./src/lib/api";
import { clearTokens, getTokens } from "./src/lib/auth";
import { connectPowerSync, db, signOut } from "./src/lib/powersync";
import { registerForPush } from "./src/lib/push";
import type { RootStackParamList } from "./src/navigation";
import { AccountScreen } from "./src/screens/Account";
import { CalendarScreen } from "./src/screens/Calendar";
import { CatalogScreen } from "./src/screens/Catalog";
import { ClientsScreen } from "./src/screens/Clients";
import { GiftCardsScreen } from "./src/screens/GiftCards";
import { HomeScreen } from "./src/screens/Home";
import { InboxScreen } from "./src/screens/Inbox";
import { InvoicesScreen } from "./src/screens/Invoices";
import { LoginScreen } from "./src/screens/Login";
import { OnboardingScreen } from "./src/screens/Onboarding";
import { PaymentsScreen } from "./src/screens/PaymentsSettings";
import { PayoutsScreen } from "./src/screens/Payouts";
import { ComingSoon } from "./src/screens/Placeholder";
import { POSScreen } from "./src/screens/POS";
import { ReportsScreen } from "./src/screens/Reports";
import { ReviewsScreen } from "./src/screens/Reviews";
import { SettingsScreen } from "./src/screens/Settings";
import { TaxesScreen } from "./src/screens/Taxes";
import { TeamScreen } from "./src/screens/Team";

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: theme.colors.bg },
};

function Tabs() {
    return (
        <Tab.Navigator
            initialRouteName="Clients"
            tabBar={(props) => <TabBar {...props} />}
            screenOptions={{ headerShown: false }}
        >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Calendar" component={CalendarScreen} />
            <Tab.Screen name="Clients" component={ClientsScreen} />
            <Tab.Screen name="Inbox" component={InboxScreen} />
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
            void handleSignOut();
        });
    }, [handleSignOut]);

    useEffect(() => {
        void getTokens().then((t) => {
            setAuthed(t !== null);
        });
    }, []);

    useEffect(() => {
        if (authed) {
            void connectPowerSync(api.authFetch);
            void registerForPush();
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
            <AuthedApp onSignOut={() => void handleSignOut()} />
        </PowerSyncContext.Provider>
    );
}

/** Inside PowerSyncContext so it can gate an authed-but-no-business user (a fresh sign-up) into the
 *  onboarding step until their business has synced, then mount the Stripe-enabled app. */
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
                            name="Settings"
                            component={SettingsScreen}
                            options={{ title: "Settings" }}
                        />
                        <RootStack.Screen
                            name="Team"
                            component={TeamScreen}
                            options={{ title: "Team" }}
                        />
                        <RootStack.Screen
                            name="Account"
                            component={AccountScreen}
                            options={{ title: "Account" }}
                        />
                        <RootStack.Screen
                            name="Catalog"
                            component={CatalogScreen}
                            options={{ title: "Catalog & services" }}
                        />
                        <RootStack.Screen
                            name="Taxes"
                            component={TaxesScreen}
                            options={{ title: "Taxes" }}
                        />
                        <RootStack.Screen
                            name="Payments"
                            component={PaymentsScreen}
                            options={{ title: "Payments" }}
                        />
                        <RootStack.Screen
                            name="Scheduling"
                            component={ComingSoon}
                            options={{ title: "Scheduling" }}
                        />
                        <RootStack.Screen
                            name="Booking"
                            component={ComingSoon}
                            options={{ title: "Booking & forms" }}
                        />
                        <RootStack.Screen
                            name="Invoices"
                            component={InvoicesScreen}
                            options={{ title: "Invoices" }}
                        />
                        <RootStack.Screen
                            name="POS"
                            component={POSScreen}
                            options={{ title: "Point of sale" }}
                        />
                        <RootStack.Screen
                            name="GiftCards"
                            component={GiftCardsScreen}
                            options={{ title: "Gift cards" }}
                        />
                        <RootStack.Screen
                            name="Payouts"
                            component={PayoutsScreen}
                            options={{ title: "Payouts" }}
                        />
                        <RootStack.Screen
                            name="Reviews"
                            component={ReviewsScreen}
                            options={{ title: "Reviews" }}
                        />
                        <RootStack.Screen
                            name="Reports"
                            component={ReportsScreen}
                            options={{ title: "Reports" }}
                        />
                    </RootStack.Group>
                </RootStack.Navigator>
            </NavigationContainer>
        </StripeAppProvider>
    );
}
