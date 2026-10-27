import { StatusBar } from "expo-status-bar";
import { type ReactElement, type ReactNode, useCallback } from "react";
import {
    checkSession,
    strings,
    BusinessZoneContext,
    useBusinessLoad,
    useBusinessSelection,
    useReplicaSession,
    useServerZones,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { PowerSyncContext } from "@powersync/react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppState, LogBox, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
    Button,
    ConfirmHost,
    configureStripe,
    LoadFailed,
    PageFrame,
    Select,
    SendReviewHost,
    useTabletLayout,
} from "@clientbridge/ui";

import { RecordPaper } from "./src/components/DocumentPreview";
import { StripeAppProvider } from "./src/components/Stripe";
import { Splash, revealApp } from "./src/components/Splash";
import { ShellBanners, TabBar } from "./src/components/TabBar";
import { api, identity, onSignedOut, selectBusiness } from "./src/lib/api";
import { clearSession, getSession, rememberUser, signIn } from "./src/lib/auth";
import { stripePublishableKey } from "./src/lib/config";
import { connectPowerSync, replica, signOut } from "./src/lib/powersync";
import { registerForPush, unregisterFromPush, usePushTaps } from "./src/lib/push";
import { useOpenLink } from "./src/lib/links";
import { SignOutContext } from "./src/lib/session";
import type { RootStackParamList, TabParamList } from "./src/navigation";
import { ScheduleScreen } from "./src/screens/Schedule";
import { CatalogScreen } from "./src/screens/Catalog";
import { ClientsScreen } from "./src/screens/Clients";
import { GetSetUpScreen } from "./src/screens/GetSetUp";
import { TaxesScreen } from "./src/screens/Taxes";
import { ClientHistoryScreen } from "./src/screens/ClientHistory";
import { ClientSubjectsScreen } from "./src/screens/ClientSubjects";
import { ClientWalletScreen } from "./src/screens/ClientWallet";
import { InboxScreen } from "./src/screens/Inbox";
import { NotificationsScreen } from "./src/screens/Notifications";
import { SearchScreen } from "./src/screens/Search";
import { ConfirmEmailScreen, LoginScreen } from "./src/screens/Login";
import { OnboardingScreen } from "./src/screens/Onboarding";
import { PaymentsScreen } from "./src/screens/Payments";
import { GettingPaidScreen } from "./src/screens/GettingPaid";
import { PlansScreen } from "./src/screens/Plans";
import { BusinessScreen, SetupScreen, TeamHoursScreen } from "./src/screens/Setup";
import { TodayScreen } from "./src/screens/Today";
import { ClassesScreen } from "./src/screens/Classes";
import { OnlineBookingScreen } from "./src/screens/OnlineBooking";
import { RecurrencesScreen } from "./src/screens/Recurrences";
import { RemindersScreen } from "./src/screens/Reminders";
import { ResourcesScreen } from "./src/screens/Resources";
import { SecurityScreen } from "./src/screens/Security";

configureStripe(stripePublishableKey);
// transport failures already show in the shell's sync banner; the dev overlay only repeats them
LogBox.ignoreLogs([/^\[PowerSync\]: Sync error/]);

const Tab = createBottomTabNavigator<TabParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: theme.colors.bg },
};

function Tabs() {
    const open = useOpenLink();
    const tablet = useTabletLayout();
    usePushTaps(
        useCallback(
            (threadId: string) => {
                open("inbox", threadId);
            },
            [open],
        ),
    );
    return (
        <Tab.Navigator
            initialRouteName="Today"
            tabBar={(props) => <TabBar {...props} />}
            screenOptions={{ headerShown: false, tabBarPosition: tablet ? "left" : "bottom" }}
            screenLayout={({ children }) => (
                <PageFrame leading={tablet ? <ShellBanners /> : undefined}>
                    {children}
                </PageFrame>
            )}
        >
            <Tab.Screen name="Today" component={TodayScreen} />
            <Tab.Screen name="Inbox" component={InboxScreen} />
            <Tab.Screen name="Clients" component={ClientsScreen} />
            <Tab.Screen name="Schedule" component={ScheduleScreen} />
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

async function endSession(): Promise<void> {
    const token = (await getSession())?.session_token;
    await clearSession();
    if (token) await identity.signOut(token).catch(() => undefined);
}

const lifecycle = {
    validate: async (stale: () => boolean) => {
        const stored = await getSession();
        const session = await checkSession(
            api.forBusiness(null),
            stored?.user_id ?? null,
            stored?.verified_at,
        );
        if (stale()) return;
        if (session.state !== "user") throw new Error("session requires attention");
        await rememberUser(session.userId, session.verifiedAt);
    },
    subscribeResume: (refresh: () => void) => {
        const listener = AppState.addEventListener("change", (state) => {
            if (state === "active") refresh();
        });
        return () => {
            listener.remove();
        };
    },
    restore: async (stale: () => boolean) => {
        const stored = await getSession();
        const session =
            stored === null
                ? { state: "none" as const }
                : await checkSession(api.forBusiness(null), stored.user_id, stored.verified_at);
        // A replaced restore (development runs effects twice) must not touch the replica.
        if (stale()) return null;
        if (session.state !== "user") {
            await replica.pause();
            return session.state === "unverified" ? "unverified" : null;
        }
        await rememberUser(session.userId, session.verifiedAt);
        if (stale()) return null;
        return connectPowerSync(api);
    },
    pause: () => replica.pause(),
    discard: async () => {
        await unregisterFromPush();
        await endSession();
        await signOut();
    },
    subscribe: onSignedOut,
    clearCredentials: endSession,
    onReady: () => {
        registerForPush().catch(() => undefined);
    },
};

function Root() {
    const { db, loading, failed, unverified, restore, discard, retry, reauthenticate } =
        useReplicaSession(lifecycle);
    if (loading || failed) {
        return (
            <View style={styles.boot}>
                {failed ? (
                    <>
                        <LoadFailed
                            message={failed === "offline" ? strings.sync.offlineExpired : undefined}
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
    if (unverified)
        return (
            <ConfirmEmailScreen
                onContinue={restore}
                onSignOut={() => {
                    discard();
                }}
            />
        );
    if (!db)
        return (
            <LoginScreen
                onSuccess={(sessionToken) => {
                    const stored = sessionToken ? signIn(sessionToken) : Promise.resolve();
                    stored.then(restore).catch(() => undefined);
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
    // A newer server zone table rerenders every formatted time once.
    const zones = useServerZones(api);
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
        <BusinessZoneContext.Provider key={zones} value={business.zone}>
            <SignOutContext.Provider value={onSignOut}>
                <StripeAppProvider>
                    <>
                        <NavigationContainer theme={navTheme}>
                            <RootStack.Navigator screenOptions={{ headerShown: false }}>
                                <RootStack.Screen name="Tabs" component={Tabs} />
                                <RootStack.Screen
                                    name="Search"
                                    component={SearchScreen}
                                    layout={framed}
                                />
                                <RootStack.Screen
                                    name="Notifications"
                                    component={NotificationsScreen}
                                    layout={framed}
                                />
                                <RootStack.Group
                                    screenLayout={framed}
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
                                        options={{
                                            title: strings.navigation.setupSections.business,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Services"
                                        component={CatalogScreen}
                                        options={{
                                            title: strings.navigation.setupSections.services,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Team"
                                        component={TeamHoursScreen}
                                        options={{ title: strings.navigation.setupSections.team }}
                                    />
                                    <RootStack.Screen
                                        name="GettingPaid"
                                        component={GettingPaidScreen}
                                        options={{
                                            title: strings.navigation.setupSections.gettingPaid,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Plans"
                                        component={PlansScreen}
                                        options={{ title: strings.navigation.setupSections.plan }}
                                    />
                                    <RootStack.Screen
                                        name="ClientHistory"
                                        component={ClientHistoryScreen}
                                        options={({ route }) => ({ title: route.params.name })}
                                    />
                                    <RootStack.Screen
                                        name="ClientSubjects"
                                        component={ClientSubjectsScreen}
                                        options={({ route }) => ({
                                            title: strings.subjects.many(route.params.kind),
                                        })}
                                    />
                                    <RootStack.Screen
                                        name="ClientWallet"
                                        component={ClientWalletScreen}
                                        options={{ title: strings.clients.wallet.title }}
                                    />
                                    <RootStack.Screen
                                        name="OnlineBooking"
                                        component={OnlineBookingScreen}
                                        options={{
                                            title: strings.navigation.setupSections.onlineBooking,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Reminders"
                                        component={RemindersScreen}
                                        options={{
                                            title: strings.navigation.setupSections.reminders,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Resources"
                                        component={ResourcesScreen}
                                        options={{
                                            title: strings.navigation.setupSections.resources,
                                        }}
                                    />
                                    <RootStack.Screen
                                        name="Security"
                                        component={SecurityScreen}
                                        options={{
                                            title: strings.navigation.setupSections.security,
                                        }}
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
                        <SendReviewHost document={(d) => <RecordPaper {...d} />} />
                    </>
                </StripeAppProvider>
            </SignOutContext.Provider>
        </BusinessZoneContext.Provider>
    );
}

function framed({ children }: { children: ReactElement }) {
    return <PageFrame>{children}</PageFrame>;
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
