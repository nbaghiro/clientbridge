// every e2e run owns copies of the demo businesses whose ids, logins and slugs end in its namespace
function setting(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set; run the lane through make test-functional`);
    return value;
}

export function runNamespace(): string {
    return setting("E2E_NAMESPACE");
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

/** A URL the runner set for this run's services. */
export function runUrl(name: string): string {
    return setting(name);
}
