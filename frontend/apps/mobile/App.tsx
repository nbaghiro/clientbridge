import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import {
    strings,
    useBusinessLoad,
    useBusinessSelection,
    useReplicaSession,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { PowerSyncContext } from "@powersync/react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Button, ConfirmHost, configureStripe, LoadFailed, Select } from "@clientbridge/ui";

import { StripeAppProvider } from "./src/components/Stripe";
import { Splash, revealApp } from "./src/components/Splash";
import { TabBar } from "./src/components/TabBar";
import { api, onSignedOut, selectBusiness } from "./src/lib/api";
import { clearTokens, getTokens } from "./src/lib/auth";
import { stripePublishableKey } from "./src/lib/config";
import { connectPowerSync, replica, signOut } from "./src/lib/powersync";
import { registerForPush } from "./src/lib/push";
import { SignOutContext } from "./src/lib/session";
import type { RootStackParamList, TabParamList } from "./src/navigation";
import { ScheduleScreen } from "./src/screens/Schedule";
import { CatalogScreen } from "./src/screens/Catalog";
import { ClientsScreen } from "./src/screens/Clients";
import { GetSetUpScreen } from "./src/components/GetSetUp";
import { TaxesScreen } from "./src/screens/Taxes";
import {
    ClientHistoryScreen,
    ClientPetsScreen,
    ClientWalletScreen,
} from "./src/components/ClientScreens";
import { InboxScreen } from "./src/screens/Inbox";
import { NotificationsScreen } from "./src/screens/Notifications";
import { SearchScreen } from "./src/screens/Search";
import { LoginScreen } from "./src/screens/Login";
import { OnboardingScreen } from "./src/screens/Onboarding";
import { PaymentsScreen } from "./src/screens/Payments";
import { GettingPaidScreen } from "./src/screens/GettingPaid";
import { BusinessScreen, SetupScreen, TeamHoursScreen } from "./src/screens/Setup";
import { TodayScreen } from "./src/screens/Today";
import { ClassesScreen } from "./src/screens/Classes";
import { OnlineBookingScreen } from "./src/screens/OnlineBooking";
import { RecurrencesScreen } from "./src/screens/Recurrences";
import { RemindersScreen } from "./src/screens/Reminders";

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
            <Tab.Screen name="Schedule" component={ScheduleScreen} />
            <Tab.Screen name="Clients" component={ClientsScreen} />
            <Tab.Screen name="Inbox" component={InboxScreen} />
        </Tab.Navigator>
    );
}

export function App() {
    return (
        <SafeAreaProvider onLayout={revealApp}>
            <StatusBar style="dark" />
            <Root />
            <ConfirmHost />
        </SafeAreaProvider>
    );
}

const lifecycle = {
    restore: async () => {
        if (await getTokens()) return connectPowerSync(api);
        await replica.pause();
        return null;
    },
    pause: () => replica.pause(),
    discard: async () => {
        await clearTokens();
        await signOut();
    },
    subscribe: onSignedOut,
    clearCredentials: clearTokens,
    onReady: () => {
        registerForPush().catch(() => undefined);
    },
};

function Root() {
    const { db, loading, failed, restore, discard, retry, reauthenticate } =
        useReplicaSession(lifecycle);
    if (loading || failed) {
        return (
            <View style={styles.boot}>
                {failed ? (
                    <>
                        <LoadFailed
                            variant="page"
                            onRetry={() => {
                                retry();
                            }}
                            retrying={loading}
                            actions={
                                <Button variant="quiet" onPress={reauthenticate}>
                                    {strings.sync.signInAgain}
                                </Button>
                            }
                        />
                    </>
                ) : (
                    <Splash />
                )}
            </View>
        );
    }
    if (!db)
        return (
            <LoginScreen
                onSuccess={() => {
                    restore();
                }}
            />
        );
    return (
        <PowerSyncContext.Provider value={db}>
            <BusinessScope onRetry={restore}>
                {(businessKey) => (
                    <AuthedApp
                        key={businessKey}
                        onSignOut={() => {
                            discard();
                        }}
                    />
                )}
            </BusinessScope>
        </PowerSyncContext.Provider>
    );
}

function AuthedApp({ onSignOut }: { onSignOut: () => void }) {
    const business = useBusinessLoad();
    if (!business.ready) {
        if (business.state === "empty") return <OnboardingScreen onSignOut={onSignOut} />;
        return (
            <View style={styles.boot}>
                {business.state === "error" ? (
                    <LoadFailed
                        variant="page"
                        onRetry={business.retry}
                        retrying={business.retrying}
                    />
                ) : (
                    <Splash />
                )}
            </View>
        );
    }

    return (
        <SignOutContext.Provider value={onSignOut}>
            <StripeAppProvider>
                <NavigationContainer theme={navTheme}>
                    <RootStack.Navigator screenOptions={{ headerShown: false }}>
                        <RootStack.Screen name="Tabs" component={Tabs} />
                        <RootStack.Screen name="Search" component={SearchScreen} />
                        <RootStack.Screen name="Notifications" component={NotificationsScreen} />
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
                                name="Payments"
                                component={PaymentsScreen}
                                options={{ title: strings.navigation.payments }}
                            />
                            <RootStack.Screen
                                name="Setup"
                                component={SetupScreen}
                                options={{ title: strings.navigation.setup }}
                            />
                            <RootStack.Screen
                                name="GetSetUp"
                                component={GetSetUpScreen}
                                options={{ title: strings.navigation.setupSections.start }}
                            />
                            <RootStack.Screen
                                name="Taxes"
                                component={TaxesScreen}
                                options={{ title: strings.navigation.setupSections.taxes }}
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
                            <RootStack.Screen
                                name="ClientHistory"
                                component={ClientHistoryScreen}
                                options={({ route }) => ({ title: route.params.name })}
                            />
                            <RootStack.Screen
                                name="ClientPets"
                                component={ClientPetsScreen}
                                options={{ title: strings.clients.pets.pets }}
                            />
                            <RootStack.Screen
                                name="ClientWallet"
                                component={ClientWalletScreen}
                                options={{ title: strings.clients.wallet.title }}
                            />
                            <RootStack.Screen
                                name="OnlineBooking"
                                component={OnlineBookingScreen}
                                options={{ title: strings.navigation.setupSections.onlineBooking }}
                            />
                            <RootStack.Screen
                                name="Reminders"
                                component={RemindersScreen}
                                options={{ title: strings.navigation.setupSections.reminders }}
                            />
                            <RootStack.Screen
                                name="Classes"
                                component={ClassesScreen}
                                options={{ title: strings.classes.title }}
                            />
                            <RootStack.Screen
                                name="Recurrences"
                                component={RecurrencesScreen}
                                options={{ title: strings.recurrences.listTitle }}
                            />
                        </RootStack.Group>
                    </RootStack.Navigator>
                </NavigationContainer>
            </StripeAppProvider>
        </SignOutContext.Provider>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center" },
});

function BusinessScope({
    children,
    onRetry,
}: {
    children: (key: string) => ReactNode;
    onRetry: () => void;
}) {
    const business = useBusinessSelection(selectBusiness);
    return (
        <>
            {business.options.length > 1 ? (
                <Select
                    label={strings.business.selectBusiness}
                    placeholder={strings.business.chooseBusiness}
                    options={business.options}
                    value={business.selectedId ?? ""}
                    onChange={business.choose}
                    disabled={business.busy}
                    error={business.error}
                />
            ) : null}
            {business.ready ? (
                children(business.selectedId ?? "onboarding")
            ) : business.error ? (
                <LoadFailed variant="page" onRetry={onRetry} retrying={false} />
            ) : business.needsChoice ? null : (
                <Splash />
            )}
        </>
    );
}
