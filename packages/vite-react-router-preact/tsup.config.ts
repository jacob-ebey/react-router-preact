import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/vite-react-router-preact.ts"],
	dts: true,
	format: ["esm"],
	platform: "node",
});
