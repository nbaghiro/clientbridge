import { type ConfirmOptions, strings } from "@clientbridge/app-core/public";
import { useEffect, useState } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

interface Request {
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
}

let show: ((request: Request) => void) | null = null;

/** Asks a yes/no question in the app's own dialog; resolves false when dismissed. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        if (show === null) {
            resolve(window.confirm(options.message ?? options.title));
            return;
        }
        show({ options, resolve });
    });
}

/** Mounted once at the app root so confirm() has somewhere to render. */
export function ConfirmHost() {
    const [request, setRequest] = useState<Request | null>(null);
    useEffect(() => {
        show = setRequest;
        return () => {
            show = null;
        };
    }, []);
    if (request === null) return null;
    const close = (ok: boolean): void => {
        request.resolve(ok);
        setRequest(null);
    };
    const { title, message, confirmLabel, cancelLabel, destructive } = request.options;
    return (
        <Modal
            size="sm"
            onClose={() => {
                close(false);
            }}
        >
            <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
            {message !== undefined ? <p className="mt-2 text-sm text-ink-soft">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
                <Button
                    variant="quiet"
                    onPress={() => {
                        close(false);
                    }}
                >
                    {cancelLabel ?? strings.common.cancel}
                </Button>
                <Button
                    variant={destructive === true ? "danger" : "primary"}
                    onPress={() => {
                        close(true);
                    }}
                >
                    {confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}
