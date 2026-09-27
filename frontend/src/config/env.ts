// NEXT_PUBLIC_* values are inlined at build time, so each one is referenced literally.
export const ENV = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws",
  useMocks: process.env.NEXT_PUBLIC_USE_MOCKS === "true",
  basemapLightUrl:
    process.env.NEXT_PUBLIC_BASEMAP_LIGHT_URL || "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  basemapDarkUrl:
    process.env.NEXT_PUBLIC_BASEMAP_DARK_URL || "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  isDev: process.env.NODE_ENV !== "production",
} as const;
