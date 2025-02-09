"use client";

import { h, type VNode } from "preact";
import { decode } from "preact-server-components";
import { useContext, useMemo } from "preact/hooks";
import {
	createBrowserRouter,
	createPath,
	NavigationType,
	Outlet,
	RouterProvider,
	UNSAFE_createRouter,
	UNSAFE_FrameworkContext,
	UNSAFE_RouteContext,
	useActionData,
	useLoaderData,
	useMatches,
	useParams,
	useRouteError,
	type ClientActionFunction,
	type ClientLoaderFunction,
	type DataRouteObject,
	type DataStrategyResult,
	type ShouldRevalidateFunction,
	type To,
	type UNSAFE_AssetsManifest,
	type UNSAFE_RouteModules,
} from "react-router";

import type { RouterRenderPayload, ServerPayload } from "./server.ts";

export { Outlet };

export function WrappedError({ element }: { element: VNode<any> }) {
	element.props.actionData = useActionData();
	element.props.loaderData = useLoaderData();
	element.props.params = useParams();
	element.props.error = useRouteError();
	return element;
}

export function WrappedRoute({ element }: { element: VNode<any> }) {
	element.props.actionData = useActionData();
	element.props.loaderData = useLoaderData();
	element.props.params = useParams();
	element.props.matches = useMatches();
	return element;
}

const cachedRoutes = new Map<
	string,
	Map<string, VNode<any> & { outdated?: boolean }>
>();
const cachedData = new Map<
	string,
	Map<string, { actionData: unknown; loaderData: unknown }>
>();
const seen = new WeakMap<object, WeakSet<object>>();
function cacheRoutes(
	rendered: DataRouteObject[],
	loaderData: any,
	actionData?: any,
) {
	for (const route of rendered) {
		if (!seen.get(route)?.has(loaderData)) {
			const seenCache = seen.get(route) ?? new WeakSet();
			seen.set(route, seenCache);
			seenCache.add(loaderData);
			const dataCache = cachedData.get(route.id) ?? new Map();
			cachedData.set(route.id, dataCache);
			dataCache.set((route as unknown as { pathname: string }).pathname, {
				actionData: actionData?.[route.id],
				loaderData: loaderData[route.id],
			});
		}

		const cache = cachedRoutes.get(route.id) ?? new Map();
		cachedRoutes.set(route.id, cache);
		const existing = cache.get(
			(route as unknown as { pathname: string }).pathname,
		);
		if (existing) {
			existing.outdated = false;
		} else {
			cache.set(
				(route as unknown as { pathname: string }).pathname,
				route.element,
			);
		}
		if (route.children) {
			cacheRoutes(route.children, loaderData, actionData);
		}
	}
}

function createHydratedRoutes(
	matches: { id: string }[],
	rendered: Record<string, DataRouteObject>,
	loaderData: any,
	actionData?: any,
): DataRouteObject[] {
	cacheRoutes(Object.values(rendered), loaderData, actionData);

	let last: DataRouteObject | undefined;
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		const route = rendered[match.id];
		const hydratedRoute = {
			...route,
			lazy: async () => {
				let shouldRevalidate: ShouldRevalidateFunction | undefined;
				let rawShouldRevalidate = (
					(route as any).clientShouldRevalidate as unknown as {
						type: { raw: () => Promise<ShouldRevalidateFunction> };
					}
				)?.type?.raw;
				if (rawShouldRevalidate) {
					shouldRevalidate = await rawShouldRevalidate();
					hydratedRoute.shouldRevalidate = shouldRevalidate;
				}

				return {
					shouldRevalidate,
				};
			},
			element: h(HydratedRoute, {
				id: route.id,
				pathname: (route as unknown as { pathname: string }).pathname,
			}) as any,
			children: last ? [last] : undefined,
		} as DataRouteObject;
		last = hydratedRoute;
	}
	if (!last) throw new Error("No last route");
	return [last];
}

function createServerRoutes(
	matches: { id: string }[],
	rendered: Record<string, DataRouteObject>,
) {
	let last: DataRouteObject | undefined;
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		const route = rendered[match.id];
		last = {
			...route,
			children: last ? [last] : undefined,
		} as DataRouteObject;
	}
	if (!last) throw new Error("No last route");
	return [last];
}

function HydratedRoute() {
	const {
		pathname,
		route: { id },
	} = (useContext(UNSAFE_RouteContext as any) as any).matches[
		(useContext(UNSAFE_RouteContext as any) as any).matches.length - 1
	];

	return cachedRoutes.get(id)?.get(pathname) ?? null;
}

// const cachedPatches = new Set();
// let browserRouter: ReturnType<typeof createBrowserRouter> | undefined;
const pathsCache = new WeakMap<object, Set<string>>();
const rotuerCache = new WeakMap<
	object,
	ReturnType<typeof createBrowserRouter>
>();
export function ClientRouter({
	payload,
}: {
	payload: RouterRenderPayload;
}) {
	const router = useMemo(() => {
		const hydrationData = {
			actionData: payload.actionData,
			errors: payload.errors,
			loaderData: Object.fromEntries(
				Object.entries(payload.loaderData).filter(
					([key]) => !payload.rendered[key]?.hydrateFallbackElement,
				),
			),
		};

		if (typeof document !== "undefined") {
			const hydratedRoutes = createHydratedRoutes(
				payload.matches,
				payload.rendered,
				payload.loaderData,
				payload.actionData,
			);
			const cachedPatches = pathsCache.get(payload) ?? new Set();
			pathsCache.set(payload, cachedPatches);
			cachedPatches.add(payload.url.pathname);
			let browserRouter = rotuerCache.get(payload);
			if (!browserRouter) {
				browserRouter = createBrowserRouter(hydratedRoutes, {
					hydrationData,
					async patchRoutesOnNavigation({ matches, patch, path }) {
						if (cachedPatches.has(path)) return;
						cachedPatches.add(path);

						// TODO: Take into account existing matches that don't want to revalidate
						const url = new URL(path, window.location.origin);
						url.pathname += ".data";
						await fetch(url)
							.then(async (response) => {
								if (!response.body) {
									throw new Error("No body");
								}
								const serverPayload = await decode<ServerPayload>(
									response.body.pipeThrough(new TextDecoderStream()),
									{
										decodeClientReference: window.__DECODE_CLIENT_REFERENCE__,
										decodeServerReference: window.__DECODE_SERVER_REFERENCE__,
									},
								);
								const payload = (
									serverPayload.root.props as unknown as {
										payload: RouterRenderPayload;
									}
								).payload;

								if (payload.type === "render") {
									const patchRecursive = (
										routes: DataRouteObject[],
										id: string | null = null,
									) => {
										patch(id, routes);
										for (const route of routes) {
											if (route.children) {
												patchRecursive(route.children, route.id);
											}
										}
									};
									patchRecursive(
										createHydratedRoutes(
											payload.matches,
											payload.rendered,
											payload.loaderData,
											payload.actionData,
										),
									);
								}
							})
							.catch(() => {
								cachedPatches.delete(path);
							});
					},
					async dataStrategy({
						fetcherKey,
						matches,
						params,
						request,
						context,
					}) {
						if (request.method !== "GET") {
							const matchesToLoad = matches.filter((m) => m.shouldLoad);

							let callServerPromise: Promise<RouterRenderPayload> | undefined;
							const callServer = async (id: string) => {
								const url = new URL(request.url);
								url.pathname += ".data";
								if (!callServerPromise) {
									for (const [key, cache] of cachedRoutes.entries()) {
										for (const [pathname, route] of cache.entries()) {
											route.outdated = true;
										}
									}

									callServerPromise = fetch(
										new Request(url, {
											body:
												url.protocol !== "https:"
													? await request.blob()
													: request.body,
											duplex: "half",
											headers: request.headers,
											method: request.method,
											signal: request.signal,
										} as RequestInit & { duplex?: "half" }),
									).then(async (response) => {
										if (!response.body) {
											throw new Error("No body");
										}
										const serverPayload = await decode<ServerPayload>(
											response.body.pipeThrough(new TextDecoderStream()),
											{
												decodeClientReference:
													window.__DECODE_CLIENT_REFERENCE__,
												decodeServerReference:
													window.__DECODE_SERVER_REFERENCE__,
											},
										);
										return (
											serverPayload.root.props as unknown as {
												payload: RouterRenderPayload;
											}
										).payload;
									});
								}
								return callServerPromise.then((payload) => {
									cacheRoutes(
										Object.values(payload.rendered),
										payload.loaderData,
										payload.actionData,
									);
									return payload.actionData?.[id];
								});
							};

							const results = await Promise.all(
								matchesToLoad.map(async (match) => {
									const result = await match.resolve(async () => {
										let actionData: any;

										const clientActionRef = (match.route as any)
											.clientAction as any;
										if (typeof clientActionRef?.type?.raw === "function") {
											const clientAction: ClientActionFunction =
												await clientActionRef.type.raw();
											actionData = await clientAction({
												context,
												params,
												request,
												serverAction: async () =>
													callServer(match.route.id) as any,
											});
										} else {
											actionData = await callServer(match.route.id);
										}

										return actionData;
									});
									return result;
								}),
							);

							return results.reduce(
								(acc, result, i) =>
									Object.assign(acc, {
										[matchesToLoad[i].route.id]: result,
									}),
								{},
							);
						}

						if (fetcherKey) {
							let fetcherMatch = matches.find((m) => m.shouldLoad);
							if (!fetcherMatch) {
								throw new Error("No fetcher match found");
							}
							const matchesToLoad = [fetcherMatch];

							const url = new URL(request.url);
							url.pathname += ".data";
							url.searchParams.set("_route", fetcherMatch.route.id);

							let callServerPromise: Promise<any> | undefined;
							const callServer = () => {
								if (callServerPromise) return callServerPromise;
								callServerPromise = fetch(
									new Request(url, {
										headers: request.headers,
										signal: request.signal,
									} as RequestInit),
								).then(async (response) => {
									if (!response.body) {
										throw new Error("No body");
									}
									const routerPayload = await decode<any>(
										response.body.pipeThrough(new TextDecoderStream()),
										{
											decodeClientReference: window.__DECODE_CLIENT_REFERENCE__,
											decodeServerReference: window.__DECODE_SERVER_REFERENCE__,
										},
									);
									return routerPayload;
								});
								return callServerPromise;
							};

							const results = await Promise.all(
								matchesToLoad.map(async (match) => {
									const result = await match.resolve(async () => {
										let data: any;
										const clientMethodRef = (match.route as any)[
											request.method !== "GET" ? "clientAction" : "clientLoader"
										];
										if (typeof clientMethodRef?.type?.raw === "function") {
											const clientMethod:
												| ClientActionFunction
												| ClientLoaderFunction =
												await clientMethodRef.type.raw();
											data = await clientMethod({
												context,
												params,
												request,
												[request.method !== "GET"
													? "serverAction"
													: "serverLoader"]: async () => callServer(),
											} as any);
										} else {
											data = await callServer();
										}

										return data;
									});
									return result;
								}),
							);

							return results.reduce(
								(acc, result, i) =>
									Object.assign(acc, {
										[matchesToLoad[i].route.id]: result,
									}),
								{},
							);
						}

						const matchesToLoad = matches.filter((m) => m.shouldLoad);

						const missingMatches = new Set(
							matches
								.filter((match) => {
									const routeCache = cachedRoutes.get(match.route.id);
									const cachedRouted = routeCache?.get(match.pathname);
									return !cachedRouted || cachedRouted.outdated;
								})
								.map((match) => match.route.id),
						);

						let callServerPromise: Promise<RouterRenderPayload> | undefined;
						if (missingMatches.size > 0) {
							const url = new URL(request.url);
							url.pathname += ".data";

							callServerPromise = fetch(
								new Request(url, {
									headers: request.headers,
									signal: request.signal,
								} as RequestInit),
							)
								.then(async (response) => {
									if (!response.body) {
										throw new Error("No body");
									}
									const serverPayload = await decode<ServerPayload>(
										response.body.pipeThrough(new TextDecoderStream()),
										{
											decodeClientReference: window.__DECODE_CLIENT_REFERENCE__,
											decodeServerReference: window.__DECODE_SERVER_REFERENCE__,
										},
									);
									return (
										serverPayload.root.props as unknown as {
											payload: RouterRenderPayload;
										}
									).payload;
								})
								.then((payload) => {
									cacheRoutes(
										Object.values(payload.rendered),
										payload.loaderData,
										payload.actionData,
									);
									return payload;
								});
						}

						const results = await Promise.all(
							matchesToLoad.map(async (match) => {
								const serverLoaderData = callServerPromise
									? callServerPromise.then(
											(payload) => payload.loaderData[match.route.id],
										)
									: cachedData.get(match.route.id)?.get(match.pathname)
											?.loaderData;

								const result = await match.resolve(async () => {
									let loaderData = serverLoaderData;

									const clientLoaderRef = (match.route as any)
										.clientLoader as any;
									if (typeof clientLoaderRef?.type?.raw === "function") {
										const clientLoader: ClientLoaderFunction =
											await clientLoaderRef.type.raw();
										loaderData = await clientLoader({
											context,
											params,
											request,
											serverLoader: async () => serverLoaderData as any,
										});
									}

									return loaderData;
								});
								return result;
							}),
						);

						await callServerPromise;

						return results.reduce(
							(acc, result, i) =>
								Object.assign(acc, {
									[matchesToLoad[i].route.id]: result,
								}),
							Object.fromEntries(
								matchesToLoad.map((match) => [
									match.route.id,
									{
										type: "data",
										result: cachedData.get(match.route.id)?.get(match.pathname)
											?.loaderData,
									} satisfies DataStrategyResult,
								]),
							),
						);
					},
				});
			}
			rotuerCache.set(payload, browserRouter);
			return browserRouter;
		}
		return UNSAFE_createRouter({
			history: createServerHistory(payload.url),
			hydrationData: hydrationData,
			routes: createServerRoutes(payload.matches, payload.rendered),
		});
	}, [payload]);

	const frameworkContext = useMemo(
		() =>
			({
				isSpaMode: false,
				criticalCss: undefined,
				future: {},
				manifest: payload.manifest,
				routeModules: {},
			}) satisfies {
				isSpaMode: boolean;
				criticalCss?: string;
				future: { [k: string]: never };
				manifest: UNSAFE_AssetsManifest;
				routeModules: UNSAFE_RouteModules;
			},
		[payload],
	);

	return h(
		UNSAFE_FrameworkContext.Provider as any,
		{ value: frameworkContext },
		h(RouterProvider, { router }),
	);
}

function createServerHistory(url: URL) {
	return {
		action: NavigationType.Push,
		createHref(to: To) {
			const r = new URL(typeof to === "string" ? to : createPath(to), url);
			return r.pathname + r.search;
		},
		createURL(to: To) {
			return new URL(typeof to === "string" ? to : createPath(to), url);
		},
		encodeLocation(to: To) {
			return new URL(typeof to === "string" ? to : createPath(to), url);
		},
		go() {
			throw new Error("Can not go before hydration");
		},
		listen() {
			throw new Error("Can not listen before hydration");
		},
		location: {
			hash: "",
			key: "default",
			pathname: url.pathname,
			search: url.search,
			state: null,
		},
		push() {
			throw new Error("Can not push before hydration");
		},
		replace() {
			throw new Error("Can not replace before hydration");
		},
	};
}
