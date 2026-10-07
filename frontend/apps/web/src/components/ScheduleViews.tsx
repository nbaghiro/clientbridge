import { strings } from "@clientbridge/app-core";
import { Choice } from "@clientbridge/ui";
import { useNavigate } from "react-router-dom";

const s = strings.bookings;

type View = "board" | "classes" | "series";

const PATH: Record<View, string> = {
    board: "/schedule",
    classes: "/schedule/classes",
    series: "/schedule/series",
};

/** Switches the Schedule page between the day board, class rosters and repeat visits. */
export function ScheduleViews({ active }: { active: View }) {
    const navigate = useNavigate();
    return (
        <Choice
            layout="segmented"
            label={s.viewLabel}
            options={[
                { key: "board", label: s.viewBoard },
                { key: "classes", label: s.viewClasses },
                { key: "series", label: s.viewSeries },
            ]}
            value={active}
            onChange={(key) => {
                const done = navigate(PATH[key]);
                if (done) done.catch(() => undefined);
            }}
        />
    );
}
