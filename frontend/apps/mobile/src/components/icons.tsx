import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

interface IconProps {
    size?: number | undefined;
    color?: string | undefined;
}

function NavIcon({ size = 22, color = "#000", children }: IconProps & { children: ReactNode }) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: size, height: size }}
        >
            {children}
        </Svg>
    );
}

export function IconToday({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Rect x="3" y="3" width="7" height="7" rx="1.5" />
            <Rect x="14" y="3" width="7" height="7" rx="1.5" />
            <Rect x="14" y="14" width="7" height="7" rx="1.5" />
            <Rect x="3" y="14" width="7" height="7" rx="1.5" />
        </NavIcon>
    );
}
export function IconCalendar({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Rect x="3" y="4" width="18" height="18" rx="2" />
            <Path d="M16 2v4M8 2v4M3 10h18" />
        </NavIcon>
    );
}
export function IconClients({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <Circle cx="9" cy="7" r="4" />
            <Path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </NavIcon>
    );
}
export function IconInbox({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </NavIcon>
    );
}
export function IconPlus({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Path d="M12 5v14M5 12h14" />
        </NavIcon>
    );
}
export function IconSearch({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Circle cx="11" cy="11" r="8" />
            <Path d="m21 21-4.3-4.3" />
        </NavIcon>
    );
}
export function IconSettings({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Circle cx="12" cy="12" r="3" />
            <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </NavIcon>
    );
}
export function IconPos({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Rect x="2" y="5" width="20" height="14" rx="2" />
            <Path d="M2 10h20M6 15h4" />
        </NavIcon>
    );
}
export function IconChevron({ size, color }: IconProps) {
    return (
        <NavIcon size={size} color={color}>
            <Path d="m9 18 6-6-6-6" />
        </NavIcon>
    );
}

export function Logo({ size = 32, color = "#3f5e80" }: { size?: number; color?: string }) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            style={{ width: size, height: size }}
        >
            <Path
                d="M10 23a6 6 0 0 1 12 0"
                stroke={color}
                strokeWidth={2.3}
                strokeLinecap="round"
            />
            <Path
                d="M5.5 23a10.5 10.5 0 0 1 21 0"
                stroke={color}
                strokeWidth={2.3}
                strokeLinecap="round"
            />
            <Circle cx={16} cy={23} r={1.9} fill={color} />
        </Svg>
    );
}

export function GoogleIcon({ size = 20 }: { size?: number }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" style={{ width: size, height: size }}>
            <Path
                fill="#4285F4"
                d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2.01 3.44-4.97 3.44-8.39z"
            />
            <Path
                fill="#34A853"
                d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.75H1.71v2.98A12 12 0 0 0 12 24z"
            />
            <Path
                fill="#FBBC05"
                d="M5.55 14.67a7.2 7.2 0 0 1 0-4.6V7.09H1.71a12 12 0 0 0 0 10.56l3.84-2.98z"
            />
            <Path
                fill="#EA4335"
                d="M12 4.77c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.2 15.11 0 12 0A12 12 0 0 0 1.71 7.09l3.84 2.98C6.46 7.35 9 4.77 12 4.77z"
            />
        </Svg>
    );
}
