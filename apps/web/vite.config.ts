import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.io"],
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
