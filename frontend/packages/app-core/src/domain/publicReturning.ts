import { useCallback, useEffect, useRef, useState } from "react";

import { failedCode, failureMessage, refusal } from "../api";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { PublicBookingFlow } from "./publicBooking";

interface ReturningProfile {
    name: string;
    phone: string | null;
    subjects: { id: string; name: string }[];
    last_visit: {
        item_id: string;
        staff_id: string;
        subject_id: string | null;
        starts_at: string;
    } | null;
    photo_url?: string | null;
}

interface ReturningVerified {
    token: string | null;
    profile: ReturningProfile | null;
}

interface ReturningClient {
    request: (slug: string, contact: { phone: string }) => Promise<{ challenge_id: string }>;
    verify: (slug: string, challengeId: string, code: string) => Promise<ReturningVerified>;
}

export function createReturningClient(baseUrl: string): ReturningClient {
    const post = async <T>(slug: string, action: string, body: unknown): Promise<T> => {
        const response = await fetch(
            `${baseUrl}/book/${encodeURIComponent(slug)}/returning/${action}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
        );
        if (!response.ok) throw await refusal(response);
        return (await response.json()) as T;
    };
    return {
        request: (slug, contact) => post(slug, "request", contact),
        verify: (slug, challengeId, code) =>
            post(slug, "verify", { challenge_id: challengeId, code }),
    };
}

export function useReturningClient(
    client: ReturningClient,
    slug: string,
    booking?: PublicBookingFlow,
) {
    const [contact, setContact] = useState("");
    const [code, setCode] = useState("");
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verified, setVerified] = useState<ReturningVerified | null>(null);
    const [proofEnded, setProofEnded] = useState(false);
    const generation = useRef(0);
    const appliedToken = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const s = strings.publicReturning;

    // appliedToken stays held, or the apply effect re-applies the stale proof in the same commit
    const forget = useCallback((): void => {
        generation.current += 1;
        setChallengeId(null);
        setVerified(null);
        setCode("");
    }, []);

    useEffect(() => {
        forget();
        setContact("");
        setProofEnded(false);
        return () => {
            generation.current += 1;
        };
    }, [slug, forget]);

    const flowToken = useRef<string | null>(null);
    useEffect(() => {
        const held = booking?.returningToken ?? null;
        // editing the contact, or a refused booking, ends the proof; show it as unverified
        if (flowToken.current !== null && held === null && appliedToken.current !== null) {
            forget();
            setProofEnded(true);
        }
        flowToken.current = held;
    }, [booking?.returningToken, forget]);
    useEffect(() => {
        if (
            !booking ||
            !verified?.profile ||
            !verified.token ||
            appliedToken.current === verified.token
        )
            return;
        appliedToken.current = verified.token;
        applyReturning(
            booking,
            verified,
            verified.profile.last_visit?.subject_id ?? verified.profile.subjects[0]?.id ?? null,
        );
    }, [booking, verified]);
    const reset = (): void => {
        appliedToken.current = null;
        forget();
        booking?.setReturning(null);
        setError(null);
    };
    const requestCode = (): void => {
        if (busy) return;
        const value = contact.trim();
        if (value === "") {
            setError(s.contactRequired);
            return;
        }
        const requestGeneration = generation.current;
        run(
            async () => {
                const result = await client.request(slug, { phone: value });
                if (generation.current !== requestGeneration) return;
                setChallengeId(result.challenge_id);
                setVerified(null);
                setCode("");
            },
            {
                errorMessage: (e) =>
                    generation.current === requestGeneration ? requestFailure(e) : null,
            },
        );
    };
    const verifyCode = (): void => {
        if (busy || challengeId === null) return;
        if (!/^\d{6}$/.test(code.trim())) {
            setError(s.codeRequired);
            return;
        }
        const requestGeneration = generation.current;
        run(
            async () => {
                const result = await client.verify(slug, challengeId, code.trim());
                if (generation.current === requestGeneration) setVerified(result);
            },
            {
                errorMessage: (e) => {
                    if (generation.current !== requestGeneration) return null;
                    if (failedCode(e) === "code_locked") {
                        setChallengeId(null);
                        setCode("");
                    }
                    return failureMessage(e, s.verifyError);
                },
            },
        );
    };
    const stage =
        verified !== null
            ? verified.profile === null
                ? "missing"
                : "verified"
            : challengeId !== null
              ? "code"
              : "contact";
    return {
        contact,
        setContact: (value: string): void => {
            reset();
            setContact(value);
        },
        code,
        setCode,
        stage,
        busy,
        error,
        requestCode,
        verifyCode,
        reset,
        canBookUsual:
            !!verified?.profile?.last_visit &&
            !!booking?.page?.services.some(
                (service) => service.id === verified.profile?.last_visit?.item_id,
            ),
        bookUsual: () => {
            const visit = verified?.profile?.last_visit;
            if (visit && booking) booking.selectUsual(visit.item_id, visit.staff_id);
        },
        chooseSubject: (id: string) => {
            if (booking && verified) applyReturning(booking, verified, id || null);
        },
        profile: verified?.profile ?? null,
        token: verified?.token ?? null,
        proofEnded,
    };
}

function requestFailure(e: unknown): string {
    const code = failedCode(e);
    if (code === "sms_unassigned" || code === "sms_failed")
        return strings.publicReturning.textsUnavailable;
    if (code === "sms_refused") return strings.publicReturning.numberRefused;
    // the number is the request's only field, so a malformed request is a malformed number
    if (code === "invalid_request") return strings.api.invalidPhone;
    return failureMessage(e, strings.publicReturning.requestError);
}

function applyReturning(
    booking: PublicBookingFlow,
    verified: ReturningVerified,
    subjectId: string | null,
): void {
    if (!verified.profile || !verified.token) return;
    const profile = verified.profile;
    const subject =
        booking.kind === null ? undefined : profile.subjects.find((x) => x.id === subjectId);
    booking.fields.setName(profile.name);
    booking.fields.setPhone(profile.phone ?? "");
    booking.fields.setSubjectName(subject?.name ?? "");
    booking.setReturning({ token: verified.token, subjectId: subject?.id ?? null });
}
