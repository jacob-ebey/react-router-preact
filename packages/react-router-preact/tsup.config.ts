import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/react-router-preact.ts",
		"src/browser.ts",
		"src/client.ts",
		"src/dom.ts",
		"src/server.ts",
		"src/ssr.ts",
		"src/vite.browser.ts",
		"src/vite.server.ts",
		"src/vite.ssr.ts",
	],
	dts: true,
	format: ["esm"],
	platform: "neutral",
	noExternal: ["react-router", "cookie"],
	external: [
		"preact",
		"preact/compat",
		"preact/hooks",
		"preact-server-components",
		"react-router",
		"react-router/dom",
		"react-router-preact/client",
		"react-router-preact/vite.browser",
		"virtual:preact-server-components/client",
		"virtual:preact-server-components/server",
	],
});
