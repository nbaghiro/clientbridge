import { type LoadFailedProps, strings } from "@clientbridge/app-core";

import { Button } from "./Button";
import { Empty } from "./Empty";
import type { NativeProps } from "./props";

export function LoadFailed({
    actions,
    message = strings.ui.loadFailed,
    body = strings.ui.loadFailedBody,
    onRetry,
    retrying = false,
    retryLabel = strings.ui.retry,
    variant = "inline",
    style,
}: NativeProps<LoadFailedProps>) {
    return (
        <Empty
            intent="danger"
            icon="cloudOff"
            variant={variant}
            message={message}
            body={body}
            style={style}
            actions={
                onRetry !== undefined || actions !== undefined ? (
                    <>
                        {onRetry !== undefined ? (
                            <Button
                                size={variant === "page" ? "md" : "sm"}
                                variant={variant === "page" ? "primary" : "outline"}
                                icon="refresh"
                                busy={retrying}
                                onPress={onRetry}
                            >
                                {retrying ? strings.ui.retrying : retryLabel}
                            </Button>
                        ) : null}
                        {actions}
                    </>
                ) : undefined
            }
        />
    );
}
