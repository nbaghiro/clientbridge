import Svg, { Circle, Path } from "react-native-svg";

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
