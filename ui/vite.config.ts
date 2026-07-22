import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiPathPrefix } from "./src/api/ApiPath.ts";

const developmentHostUrl = "http://127.0.0.1:5000";
const grpcPathPrefix = "/terminal.v1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      [apiPathPrefix]: {
        target: developmentHostUrl,
      },
      [grpcPathPrefix]: {
        target: developmentHostUrl,
      },
    },
  },
});
