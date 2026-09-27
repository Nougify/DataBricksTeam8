import dynamic from "next/dynamic";

// MapLibre touches window/WebGL, so the map is client-only (spec §7.7).
export const ConsoleMap = dynamic(() => import("./ConsoleMapImpl"), { ssr: false });
