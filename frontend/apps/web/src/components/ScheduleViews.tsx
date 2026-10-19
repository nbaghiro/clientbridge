import { strings } from "@clientbridge/app-core";
import { PageHeader, Tabs } from "@clientbridge/ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { PageFrame } from "./PageFrame";

const s = strings.bookings;

type View = "board" | "classes" | "series";

const PATH: Record<View, string> = {
    board: "/schedule",
    classes: "/schedule/classes",
    series: "/schedule/series",
};

/** The Schedule page frame: its title, a tab for the day board, class rosters and repeat visits. */
export function ScheduleFrame({
    active,
    actions,
    children,
}: {
    active: View;
    actions: ReactNode;
    children: ReactNode;
}) {
    const navigate = useNavigate();
    return (
        <PageFrame>
            <PageHeader title={strings.navigation.schedule} actions={actions}>
                <div className="border-b border-line">
                    <Tabs
                        label={s.viewLabel}
                        items={[
                            { key: "board", label: s.viewBoard },
                            { key: "classes", label: s.viewClasses },
                            { key: "series", label: s.viewSeries },
                        ]}
                        active={active}
                        onSelect={(key) => {
                            const done = navigate(PATH[key]);
                            if (done) done.catch(() => undefined);
                        }}
                    />
                </div>
            </PageHeader>
            <div className="mt-6">{children}</div>
        </PageFrame>
    );
}
