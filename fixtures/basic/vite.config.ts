import { defineConfig } from "vite";
import inspect from "vite-plugin-inspect";
import reactRouter from "vite-react-router-preact";

export default defineConfig({
	plugins: [inspect(), reactRouter()],
});
