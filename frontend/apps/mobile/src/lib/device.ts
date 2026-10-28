import { Dimensions } from "react-native";

const screen = Dimensions.get("screen");

// A tablet (shorter side 600dp or more) rotates and runs full screen; a phone stays upright with its bars.
export const isTablet = Math.min(screen.width, screen.height) >= 600;
