import type { WebAuthnLike } from "@clientbridge/app-core";

const decode = (value: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const encode = (value: ArrayBuffer | null): string =>
    btoa(String.fromCharCode(...new Uint8Array(value ?? new ArrayBuffer(0))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

interface Descriptor {
    id: string;
    type: PublicKeyCredentialType;
}

interface Options {
    publicKey: Record<string, unknown> & {
        challenge: string;
        user?: { id: string; name: string; displayName: string };
        allowCredentials?: Descriptor[];
        excludeCredentials?: Descriptor[];
    };
}

const descriptors = (list: Descriptor[] | undefined): PublicKeyCredentialDescriptor[] =>
    (list ?? []).map((d) => ({ ...d, id: decode(d.id) }));

// The auth service hands over JSON options with base64url buffers and expects the credential back the same way.
export const webauthn: WebAuthnLike | undefined =
    "PublicKeyCredential" in window
        ? {
              async register(raw) {
                  const { publicKey } = JSON.parse(raw) as Options;
                  const user = publicKey.user ?? { id: "", name: "", displayName: "" };
                  const credential = (await navigator.credentials.create({
                      publicKey: {
                          ...(publicKey as unknown as PublicKeyCredentialCreationOptions),
                          challenge: decode(publicKey.challenge),
                          user: { ...user, id: decode(user.id) },
                          excludeCredentials: descriptors(publicKey.excludeCredentials),
                      },
                  })) as PublicKeyCredential;
                  const response = credential.response as AuthenticatorAttestationResponse;
                  return JSON.stringify({
                      id: credential.id,
                      rawId: encode(credential.rawId),
                      type: credential.type,
                      response: {
                          attestationObject: encode(response.attestationObject),
                          clientDataJSON: encode(response.clientDataJSON),
                      },
                  });
              },
              async login(raw) {
                  const { publicKey } = JSON.parse(raw) as Options;
                  const credential = (await navigator.credentials.get({
                      publicKey: {
                          ...(publicKey as unknown as PublicKeyCredentialRequestOptions),
                          challenge: decode(publicKey.challenge),
                          allowCredentials: descriptors(publicKey.allowCredentials),
                      },
                  })) as PublicKeyCredential;
                  const response = credential.response as AuthenticatorAssertionResponse;
                  return JSON.stringify({
                      id: credential.id,
                      rawId: encode(credential.rawId),
                      type: credential.type,
                      response: {
                          authenticatorData: encode(response.authenticatorData),
                          clientDataJSON: encode(response.clientDataJSON),
                          signature: encode(response.signature),
                          userHandle: encode(response.userHandle),
                      },
                  });
              },
          }
        : undefined;
