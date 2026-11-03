import type { PlaywrightTestConfig } from "@playwright/test";

/** With E2E_RECORD=1 every test keeps a video slowed to watching speed, with a cursor, action labels and its step titles. */
export function recorded<T extends PlaywrightTestConfig>(config: T): T {
    if (process.env.E2E_RECORD !== "1") return config;
    const size = config.use?.viewport ?? { width: 1280, height: 800 };
    const actions = { duration: 800, position: "bottom" } as const;
    return {
        ...config,
        // one test at a time, so the collector can match a context's video to its test by time
        workers: 1,
        retries: 0,
        // slowed actions take several times longer than a normal run
        timeout: (config.timeout ?? 30_000) * 4,
        use: {
            ...config.use,
            video: {
                mode: "on",
                size,
                show: { actions, test: { level: "step", position: "bottom-left" } },
            },
            // contexts a test opens itself skip the video option, so they record through their own
            contextOptions: {
                ...config.use?.contextOptions,
                recordVideo: {
                    dir: `${config.outputDir ?? "test-results"}/contexts`,
                    size,
                    showActions: actions,
                },
            },
            launchOptions: {
                ...config.use?.launchOptions,
                slowMo: Number(process.env.E2E_RECORD_SLOWMO ?? "500"),
            },
        },
    };
}
