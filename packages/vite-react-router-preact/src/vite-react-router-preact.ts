import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import _generate from "@babel/generator";
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { createRequestListener } from "@mjackson/node-fetch-server";
import preact from "@preact/preset-vite";
import type { Config } from "@react-router/dev/config";
import type { RouteConfig, RouteConfigEntry } from "@react-router/dev/routes";
import * as execa from "execa";
import * as vite from "vite";
import preactServerComponents from "vite-preact-server-components";
import tsconfigPaths from "vite-tsconfig-paths";

const generate = _generate.default ?? _generate;

import { removeExports } from "./lib/remove-exports.ts";

export function reactRouterNodeServer(): vite.PluginOption {
	return {
		name: "vite-react-router-node-server",
		configEnvironment(name, config) {
			if (name === "server" || name === "ssr") {
				return vite.mergeConfig<
					vite.EnvironmentOptions,
					vite.EnvironmentOptions
				>(
					{
						dev: {
							createEnvironment: (name, config) =>
								vite.createRunnableDevEnvironment(name, config),
						},
					},
					config,
				);
			}
		},
		configureServer(server) {
			const serverRunner = server.environments
				.server as vite.RunnableDevEnvironment;
			const ssrRunner = server.environments.ssr as vite.RunnableDevEnvironment;

			const listener = createRequestListener(async (request) => {
				const [serverEntry, ssrEntry] = await Promise.all([
					serverRunner.runner.import(
						fileURLToPath(
							import.meta.resolve("react-router-preact/server-entry.ts"),
						),
					),
					ssrRunner.runner.import(
						fileURLToPath(
							import.meta.resolve("react-router-preact/ssr-entry.ts"),
						),
					),
				]);

				return ssrEntry.default.fetch(request, {
					SERVER: {
						fetch(request: Request) {
							return serverEntry.default.fetch(request);
						},
					},
				});
			});

			return () => {
				server.middlewares.use((req, res) => {
					req.url = req.originalUrl;
					listener(req, res);
				});
			};
		},
	};
}

export type BaseReactRouterPreactOptions = {
	excludeTypescriptPlugins?: true;
};

export type DefaultServerReactRouterPreactOptions =
	BaseReactRouterPreactOptions & {
		customServer?: false;
		environments?: undefined;
	};

export type CustomServerReactRouterPreactOptions =
	BaseReactRouterPreactOptions & {
		customServer: true;
		environments?: {
			client?: string;
			server?: string[];
			ssr?: string[];
		};
	};

export type ReactRouterPreactOptions =
	| DefaultServerReactRouterPreactOptions
	| CustomServerReactRouterPreactOptions;

export default async function reactRouterPreact({
	customServer,
	environments: _environments,
	excludeTypescriptPlugins,
}: ReactRouterPreactOptions = {}): Promise<vite.PluginOption[]> {
	if (!customServer && _environments) {
		throw new Error("environments option requires customServer to be true");
	}

	const environments = {
		client: _environments?.client || "client",
		server: _environments?.server?.length ? _environments.server : ["server"],
		ssr: _environments?.ssr?.length ? _environments.ssr : ["ssr"],
	};
	const serverEnvironments = new Set(environments.server);
	const ssrEnvironments = new Set(environments.ssr);

	let watchCommand: execa.ResultPromise | null = null;
	let server: vite.ViteDevServer | null = null;

	let reactRouterConfig = await loadReactRouterConfig();
	const appDirectory = vite.normalizePath(
		path.resolve(process.cwd(), reactRouterConfig.appDirectory || "app"),
	);
	const routesConfigPath = findOneOf(appDirectory, "routes", [
		".ts",
		".tsx",
		".js",
		".jsx",
	]);
	if (!routesConfigPath) {
		throw new Error(`${appDirectory}/routes.[t|j]s(x) not found`);
	}

	const rootRoutePath = findOneOf(appDirectory, "root", [
		".ts",
		".tsx",
		".js",
		".jsx",
	]);
	if (!rootRoutePath) {
		throw new Error(`${appDirectory}/root.[t|j]s(x) not found`);
	}

	const routesConfig = [
		{
			id: "root",
			file: path.relative(appDirectory, rootRoutePath),
			children: await loadRoutesConfig(routesConfigPath),
		},
	];

	const resolvedRoutesModules = new Set();

	return [
		{
			name: "vite-react-router-preact",
			async buildStart() {
				if (
					this.environment.mode === "dev" ||
					!watchCommand ||
					typeof watchCommand.exitCode === "number"
				) {
					watchCommand = execa.$`npx react-router typegen --watch`;
					watchCommand.catch(() => {
						watchCommand = null;
					});
				}
				this.addWatchFile("react-router.config.ts");

				const recurse = async (entry: RouteConfigEntry) => {
					const resolved = await this.resolve(
						path.resolve(appDirectory, entry.file),
						undefined,
						{
							skipSelf: true,
						},
					);
					if (!resolved) {
						throw new Error(`Failed to resolve route module ${entry.file}`);
					}
					resolvedRoutesModules.add(resolved.id);
					if (entry.children?.length) {
						await Promise.all(entry.children.map(recurse));
					}
				};

				await Promise.all(routesConfig.map(recurse));
			},
			buildEnd() {
				watchCommand?.kill();
			},
			configureServer(_server) {
				server = _server;
			},
			async watchChange(id) {
				if (id.endsWith("react-router.config.ts")) {
					watchCommand?.kill();
					await server?.restart();
				} else {
					if (!watchCommand || typeof watchCommand.exitCode === "number") {
						watchCommand = execa.$`npx react-router typegen --watch`;
						watchCommand.catch(() => {
							watchCommand = null;
						});
					}

					if (server && serverEnvironments.has(this.environment.name)) {
						for (const clientEnvironment of [
							environments.client,
							...environments.ssr,
						]) {
							server.environments[
								clientEnvironment
							].moduleGraph.invalidateAll();
						}
					} else if (server && this.environment.name === environments.client) {
						for (const serverishEnvironment of [
							...environments.ssr,
							...environments.server,
						]) {
							server.environments[
								serverishEnvironment
							].moduleGraph.invalidateAll();
						}
					}
				}
			},
			config(config) {
				return vite.mergeConfig<vite.UserConfig, vite.UserConfig>(
					{
						// root,
						environments: Object.fromEntries(
							[
								environments.client,
								...environments.server,
								...environments.ssr,
							].map((name) => [name, {}]),
						),
						resolve: {
							dedupe: ["preact", "preact/hooks", "preact/compat"],
							alias: {
								"react-router": "react-router-preact",
								"react-router/dom": "react-router-preact/dom",
								"react-router-dom": "react-router-preact",
							},
							conditions: ["module-sync"],
							externalConditions: ["module-sync"],
						},
					},
					config,
				);
			},
			async configEnvironment(name, config) {
				if (name === environments.client) {
					return vite.mergeConfig<
						vite.EnvironmentOptions,
						vite.EnvironmentOptions
					>(
						{
							build: {
								outDir: `build/${name}`,
								rollupOptions: {
									input: fileURLToPath(
										import.meta.resolve("react-router-preact/browser-entry.ts"),
									),
								},
							},
						},
						config,
					);
				}

				if (serverEnvironments.has(name)) {
					return vite.mergeConfig<
						vite.EnvironmentOptions,
						vite.EnvironmentOptions
					>(
						{
							consumer: "server",
							build: {
								outDir: `build/${name}`,
								rollupOptions: {
									input: fileURLToPath(
										import.meta.resolve("react-router-preact/server-entry.ts"),
									),
								},
							},
							resolve: {
								noExternal: true,
								conditions: ["react-server"],
								externalConditions: ["react-server"],
							},
						},
						config,
					);
				}

				if (ssrEnvironments.has(name)) {
					return vite.mergeConfig<
						vite.EnvironmentOptions,
						vite.EnvironmentOptions
					>(
						{
							consumer: "server",
							build: {
								outDir: `build/${name}`,
								rollupOptions: {
									input: fileURLToPath(
										import.meta.resolve("react-router-preact/ssr-entry.ts"),
									),
								},
							},
							resolve: {
								noExternal: true,
							},
						},
						config,
					);
				}
			},
			async resolveId(id, importer) {
				if (id === "virtual:react-router-preact/client-routes") {
					return "\0virtual:react-router-preact/client-routes";
				}

				if (id === "virtual:react-router-preact/server-routes") {
					return "\0virtual:react-router-preact/server-routes";
				}

				if (
					id.startsWith("virtual:") ||
					isClientRouteModule(id) ||
					isServerRouteModule(id)
				) {
					return `\0${id}`;
				}

				if (id.startsWith("\0")) {
					return id;
				}

				if (
					importer &&
					importer[0] === "\0" &&
					(isClientRouteModule(importer.slice(1)) ||
						isServerRouteModule(importer.slice(1)))
				) {
					const isClientRoute = isClientRouteModule(importer.slice(1));
					const importerPath = importer.slice(
						(isClientRoute ? "client-route:".length : "server-route:".length) +
							1,
					);

					const resolved = await this.resolve(id, importerPath);
					if (resolved) {
						return {
							id: resolved.id,
							external: resolved.external,
							attributes: resolved.attributes,
							meta: resolved.meta,
							moduleSideEffects: resolved.moduleSideEffects,
							syntheticNamedExports: resolved.syntheticNamedExports,
						};
					}
				}
			},
			async load(id) {
				if (id === "\0virtual:react-router-preact/client-routes") {
					return {
						code: generateClientRoutes(appDirectory, routesConfig),
					};
				}

				if (id === "\0virtual:react-router-preact/server-routes") {
					return {
						code: generateServerRoutes(appDirectory, routesConfig),
					};
				}

				if (
					id[0] === "\0" &&
					(isClientRouteModule(id.slice(1)) || isServerRouteModule(id.slice(1)))
				) {
					const isClientRoute = isClientRouteModule(id.slice(1));
					const filepath = id.slice(
						(isClientRoute ? "client-route:".length : "server-route:".length) +
							1,
					);
					return vite.transformWithEsbuild(
						fs.readFileSync(filepath, "utf-8"),
						filepath,
						this.environment.config.esbuild
							? this.environment.config.esbuild
							: undefined,
					);
				}
			},
			transform(code, id) {
				if (id[0] === "\0" && isClientRouteModule(id.slice(1))) {
					const ast = parse(code, { sourceType: "module" });
					removeExports(ast, SERVER_ONLY_ROUTE_EXPORTS);
					ast.program.directives.push(
						t.directive(t.directiveLiteral("use client")),
					);
					const res = generate(ast, {
						sourceMaps: true,
						filename: id,
						sourceFileName: id.slice("client-route:".length),
					});
					return res;
				}
				if (id[0] === "\0" && isServerRouteModule(id.slice(1))) {
					const ast = parse(code, { sourceType: "module" });
					removeExports(ast, CLIENT_ROUTE_EXPORTS);
					ast.program.body.push(
						t.exportNamedDeclaration(
							null,
							[
								t.exportSpecifier(
									t.identifier("default"),
									t.identifier("default"),
								),
							],
							t.stringLiteral(
								"client-route:" + id.slice("server-route:".length + 1),
							),
						),
					);
					ast.program.body.push(
						t.exportAllDeclaration(
							t.stringLiteral(
								"client-route:" + id.slice("server-route:".length + 1),
							),
						),
					);
					const res = generate(ast, {
						sourceMaps: true,
						filename: id,
						sourceFileName: id.slice("server-route:".length) + 1,
					});
					return res;
				}
				return code;
			},
		},
		!excludeTypescriptPlugins && tsconfigPaths(),
		!customServer && reactRouterNodeServer(),
		preact(),
		preactServerComponents({
			environments,
			massageClientModuleId(root, id) {
				if (
					id[0] === "\0" &&
					(isClientRouteModule(id.slice(1)) || isServerRouteModule(id.slice(1)))
				) {
					return id.slice(1);
				}
				const rel = path.relative(root, id);
				return rel;
			},
		}),
	];
}

function isClientRouteModule(id: string) {
	return id.startsWith("client-route:");
}

function isServerRouteModule(id: string) {
	return id.startsWith("server-route:");
}

function generateClientRoutes(
	appDirectory: string,
	routesConfig: Awaited<RouteConfig>,
) {
	let i = 0;
	let routes = "[\n";

	const recurse = (entry: RouteConfigEntry) => {
		routes += "{";
		for (const key in entry) {
			if (key === "children") {
				if (entry.children?.length) {
					routes += "children: [\n";
					for (const child of entry.children) {
						recurse(child);
					}
					routes += "],";
				}
			} else if (key === "file") {
				routes += `import: () => import(${JSON.stringify("client-route:" + path.resolve(appDirectory, entry.file))}),\n`;
			} else {
				routes += `${JSON.stringify(key)}: ${JSON.stringify(entry[key as keyof typeof entry])},\n`;
			}
		}
		routes += "},";
	};

	for (const entry of routesConfig) {
		recurse(entry);
	}

	routes = routes.replace(/,$/, "");
	routes += "]";

	return `export default ${routes};`;
}

function generateServerRoutes(
	appDirectory: string,
	routesConfig: Awaited<RouteConfig>,
) {
	let i = 0;
	let routes = "[\n";

	const recurse = (entry: RouteConfigEntry) => {
		routes += "{";
		for (const key in entry) {
			if (key === "children") {
				if (entry.children?.length) {
					routes += "children: [\n";
					for (const child of entry.children) {
						recurse(child);
					}
					routes += "],";
				}
			} else if (key === "file") {
				routes += `import: () => import(${JSON.stringify("server-route:" + path.resolve(appDirectory, entry.file))}),\n`;
			} else {
				routes += `${JSON.stringify(key)}: ${JSON.stringify(entry[key as keyof typeof entry])},\n`;
			}
		}
		routes += "},";
	};

	for (const entry of routesConfig) {
		recurse(entry);
	}

	routes = routes.replace(/,$/, "");
	routes += "]";

	return `export default ${routes};`;
}

async function loadRoutesConfig(
	routesConfigPath: string,
): Promise<Awaited<RouteConfig>> {
	const script = `import(${JSON.stringify(pathToFileURL(routesConfigPath).href)})
			.then(async (config) => {
				console.log(JSON.stringify(await config.default, null, 4));
                process.exit(0);
			})
			.catch((reason) => {
				console.error(reason);
				process.exit(1);
			});`;
	const result = await execa.execa("node", [
		"--disable-warning=ExperimentalWarning",
		"--experimental-strip-types",
		"-e",
		script,
	]);
	if (result.exitCode !== 0) {
		throw new Error("Failed to load react-router.config.ts:\n" + result.stderr);
	}
	const routes = JSON.parse(result.stdout);

	// Go through each route recursively and add an id to each route
	let i = 0;
	const recurse = (entry: RouteConfigEntry) => {
		if (entry.file && !entry.id) {
			entry.id = entry.file.slice(0, -path.extname(entry.file).length);
		}
		if (entry.children) {
			for (const child of entry.children) {
				recurse(child);
			}
		}
	};
	recurse({ children: routes } as RouteConfigEntry);

	return routes;
}

async function loadReactRouterConfig(): Promise<Config> {
	const script = `import("./react-router.config.ts")
			.then((config) => {
				console.log(JSON.stringify(config.default, null, 4));
                process.exit(0);
			})
			.catch((reason) => {
				console.error(reason);
				process.exit(1);
			});`;
	const result = await execa.execa("node", [
		"--disable-warning=ExperimentalWarning",
		"--experimental-strip-types",
		"-e",
		script,
	]);
	if (result.exitCode !== 0) {
		throw new Error("Failed to load react-router.config.ts:\n" + result.stderr);
	}
	return JSON.parse(result.stdout);
}

function findOneOf(dir: string, base: string, exts: string[]) {
	for (const ext of exts) {
		const file = path.resolve(dir, base + ext);
		if (fs.existsSync(file)) {
			return file;
		}
	}
	return null;
}

const SERVER_ONLY_ROUTE_EXPORTS = ["loader", "action", "headers"];
const CLIENT_ROUTE_EXPORTS = [
	"clientAction",
	"clientLoader",
	"default",
	"ErrorBoundary",
	"handle",
	"HydrateFallback",
	"Layout",
	"links",
	"meta",
	"shouldRevalidate",
];
