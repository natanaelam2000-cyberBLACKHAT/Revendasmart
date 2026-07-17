import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.revendasmart.app",
  appName: "Revenda Smart",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
};

export default config;
