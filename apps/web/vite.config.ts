import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind to 0.0.0.0 so other devices on the LAN can reach the dev server
    // (e.g. http://192.168.1.44:5173 or http://rasheduls-mac-mini.local:5173).
    // The /api proxy below still targets 127.0.0.1:3002 — Vite runs on this
    // host and reaches the backend over loopback, so nothing else changes.
    host: true,
    // Vite host-checks incoming requests; raw IPs and localhost pass, but the
    // mDNS .local hostname must be allowlisted explicitly.
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.io", ".local"],
    proxy: {
      "/api": {
        // Port 3000 is squatted by a wslrelay forwarding into WSL on this
        // machine. When both listeners are bound, the proxy hits whichever
        // wins the race and we get back non-array bodies from the unrelated
        // app, which crashes every dashboard `.map/.reduce/.every` call.
        // Backend therefore listens on 3002 (PORT=3002 in .env).
        target: "http://127.0.0.1:3002",
      },
    },
  },
});
