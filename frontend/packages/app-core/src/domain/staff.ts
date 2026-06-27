import { useQuery } from "@powersync/react";

export interface StaffRow {
    id: string;
    title: string | null;
    role: string;
    color: string | null;
    status: string;
}

export function useStaff(): StaffRow[] {
    return useQuery<StaffRow>(
        "SELECT id, title, role, color, status FROM staff WHERE status = 'active' ORDER BY role",
    ).data;
}

export function staffLabel(s: StaffRow): string {
    const t = s.title ?? "";
    return t.length > 0 ? t : s.role;
}
