import { type LoadFailedProps, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Empty } from "./Empty";
import type { WebProps } from "./props";

export function LoadFailed({
    actions,
    message = strings.ui.loadFailed,
    body = strings.ui.loadFailedBody,
    onRetry,
    retrying = false,
    retryLabel = strings.ui.retry,
    variant = "inline",
    className,
}: WebProps<LoadFailedProps>) {
    return (
        <Empty
            intent="danger"
            icon="cloudOff"
            variant={variant}
            message={message}
            body={body}
            className={className}
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
