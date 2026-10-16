import type { PageMeta } from "../routes";
import { config } from "../config";
import { strings } from "../strings";

const w = strings.site.waitlist;

interface ClosingCopy {
    title: string;
    lede: string;
    primary: string;
}

/** A call to action's label: the waitlist's on the pre-launch site, otherwise the page's own. */
export const ctaLabel = (label: string): string => (config.waitlist ? w.cta : label);

/** The line under a call to action, which only promises a trial once the app is open. */
export const ctaNote = (note: string): string => (config.waitlist ? w.note : note);

/** A closing band that offers the app today, rewritten for the waitlist on the pre-launch site. */
export const closingCopy = <T extends ClosingCopy>(copy: T): T =>
    config.waitlist
        ? { ...copy, title: w.closing.title, lede: w.closing.lede, primary: w.cta }
        : copy;

/** A closing band that offers nothing time-bound, with only its button rewritten. */
export const closingButton = <T extends ClosingCopy>(copy: T): T =>
    config.waitlist ? { ...copy, primary: w.cta } : copy;

export const trialAnswer = (answer: string): string => (config.waitlist ? w.trialAnswer : answer);

const meta = (m: { headline: string; description: string }): PageMeta => ({
    title: strings.site.pageTitle(m.headline),
    headline: m.headline,
    description: m.description,
});

export const waitlistPage = {
    meta: meta(w.meta),
    thanksMeta: meta(w.thanks.meta),
    eyebrow: w.eyebrow,
    title: w.title,
    lede: w.lede,
    email: w.email,
    honeypot: w.honeypot,
    submit: w.submit,
    consent: w.consent,
    retry: w.retry,
    thanks: w.thanks,
};
