import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.revendasmart.app",
  appName: "RevendaSmart",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
};

export default config;
