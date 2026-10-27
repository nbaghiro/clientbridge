// every e2e run owns copies of the demo businesses whose ids, logins and slugs end in its namespace
/** A value the runner set for this run, such as a webhook secret. */
export function runSetting(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set; run the lane through make test-functional`);
    return value;
}

export function runNamespace(): string {
    return runSetting("E2E_NAMESPACE");
}

/** The run's copy of a seeded id, such as `bz_birchbark` or `cl_marcus`. */
export function demoId(id: string): string {
    return `${id}_${runNamespace()}`;
}

/** An address the run owns, so the tier routes its mail here: `a@b.example` → `a+0420@b.example`. */
export function runEmail(email: string): string {
    const at = email.lastIndexOf("@");
    return `${email.slice(0, at)}+${runNamespace()}${email.slice(at)}`;
}

/** The run's copy of a seeded business slug. */
export function demoSlug(slug: string): string {
    return `${slug}-${runNamespace()}`;
}

/** The run's copy of a seeded business texting number: `+12365550190` → `+12360420190`. */
export function demoPhone(number: string): string {
    return `${number.slice(0, 5)}${runNamespace()}${number.slice(-3)}`;
}

/** A URL the runner set for this run's services. */
export function runUrl(name: string): string {
    return runSetting(name);
}

/** A port the runner set for one of this run's servers. */
export function runPort(name: string): number {
    return Number(runSetting(name));
}

/** Builds and previews the `app` package in this run's own folder, which no concurrent run rewrites. */
export function runBuild(app: string, port: number | string): string {
    const out = `${runSetting("E2E_OUTPUT_DIR")}/../build-${app}`;
    const vite = `pnpm --filter ${app} exec vite`;
    return `${vite} build --outDir ${out} --emptyOutDir && ${vite} preview --outDir ${out} --port ${String(port)} --strictPort`;
}
