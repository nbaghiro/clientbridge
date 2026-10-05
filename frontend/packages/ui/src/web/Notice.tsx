import type { NoticeProps, NoticeTone } from "@clientbridge/app-core/public";

const LINE: Record<NoticeTone, string> = {
    danger: "text-danger",
    success: "text-ok-fg",
    info: "text-muted",
};

const BOX: Record<NoticeTone, string> = {
    danger: "bg-danger-bg text-danger-fg",
    success: "bg-ok-bg text-ok-fg",
    info: "bg-accent-weak text-accent-strong",
};

export function Notice({ tone, banner = false, children }: NoticeProps) {
    const role = tone === "danger" ? "alert" : "status";
    return banner ? (
        <div role={role} className={`rounded-md px-3 py-2.5 text-sm ${BOX[tone]}`}>
            {children}
        </div>
    ) : (
        <p role={role} className={`text-sm ${LINE[tone]}`}>
            {children}
        </p>
    );
}
