import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { PublicBookingFlow } from "./publicBooking";

interface ReturningProfile {
    name: string;
    email: string | null;
    phone: string | null;
    pets: { id: string; name: string }[];
    last_visit: {
        item_id: string;
        staff_id: string;
        subject_id: string | null;
        starts_at: string;
    } | null;
}

interface ReturningVerified {
    token: string | null;
    profile: ReturningProfile | null;
}

interface ReturningClient {
    request: (
        slug: string,
        contact: { email: string } | { phone: string },
    ) => Promise<{ challenge_id: string }>;
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
        if (!response.ok) throw new Error(strings.publicReturning.requestError);
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
    const [channel, setChannel] = useState<"email" | "sms">("email");
    const [contact, setContact] = useState("");
    const [code, setCode] = useState("");
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verified, setVerified] = useState<ReturningVerified | null>(null);
    const generation = useRef(0);
    const { busy, error, setError, run } = useAsyncAction();
    const s = strings.publicReturning;

    useEffect(() => {
        generation.current += 1;
        setChallengeId(null);
        setVerified(null);
        setCode("");
        setContact("");
        return () => {
            generation.current += 1;
        };
    }, [slug]);

    const appliedToken = useRef<string | null>(null);
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
            verified.profile.last_visit?.subject_id ?? verified.profile.pets[0]?.id ?? null,
        );
    }, [booking, verified]);
    const reset = (): void => {
        appliedToken.current = null;
        booking?.setReturning(null);
        generation.current += 1;
        setChallengeId(null);
        setVerified(null);
        setCode("");
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
                const result = await client.request(
                    slug,
                    channel === "email" ? { email: value } : { phone: value },
                );
                if (generation.current !== requestGeneration) return;
                setChallengeId(result.challenge_id);
                setVerified(null);
                setCode("");
            },
            { errorMessage: s.requestError },
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
            { errorMessage: s.verifyError },
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
        channel,
        setChannel: (value: "email" | "sms"): void => {
            reset();
            setChannel(value);
        },
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
        choosePet: (id: string) => {
            if (booking && verified) applyReturning(booking, verified, id || null);
        },
        profile: verified?.profile ?? null,
        token: verified?.token ?? null,
    };
}

function applyReturning(
    booking: PublicBookingFlow,
    verified: ReturningVerified,
    petId: string | null,
): void {
    if (!verified.profile || !verified.token) return;
    const profile = verified.profile;
    const pet = profile.pets.find((pet) => pet.id === petId);
    booking.fields.setName(profile.name);
    booking.fields.setEmail(profile.email ?? "");
    booking.fields.setPhone(profile.phone ?? "");
    booking.fields.setPetName(pet?.name ?? "");
    booking.setReturning({ token: verified.token, subjectId: pet?.id ?? null });
}
