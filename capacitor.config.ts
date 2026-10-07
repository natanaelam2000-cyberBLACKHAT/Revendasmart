import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.revendasmart.app",
  appName: "RevendaSmart",
  webDir: "dist/public",
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com", "facebook.com"],
    },
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
