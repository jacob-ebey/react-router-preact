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
	Map<string, VNode<any>> & { outdated?: boolean }
>();
function cacheRoutes(rendered: DataRouteObject[]) {
	for (const route of rendered) {
		const cache = cachedRoutes.get(route.id) ?? new Map();
		cachedRoutes.set(route.id, cache);
		const existing = cache.get(
			(route as unknown as { pathname: string }).pathname,
		);
		if (existing) {
			existing.props = (route.element as any)?.props ?? existing.props;
		} else {
			cache.set(
				(route as unknown as { pathname: string }).pathname,
				route.element,
			);
		}
		if (route.children) {
			cacheRoutes(route.children);
		}
	}
}

function createHydratedRoutes(
	matches: { id: string }[],
	rendered: Record<string, DataRouteObject>,
): DataRouteObject[] {
	cacheRoutes(Object.values(rendered));

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

const cachedPatches = new Set();
let browserRouter: ReturnType<typeof createBrowserRouter> | undefined;
export function ClientRouter({
	payload,
}: {
	payload: RouterRenderPayload;
}) {
	const router = useMemo(() => {
		if (typeof document !== "undefined") {
			const hydratedRoutes = createHydratedRoutes(
				payload.matches,
				payload.rendered,
			);
			cachedPatches.add(payload.url.pathname);
			if (!browserRouter) {
				browserRouter = createBrowserRouter(hydratedRoutes, {
					hydrationData: {
						actionData: payload.actionData,
						errors: payload.errors,
						loaderData: payload.loaderData,
					},
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
										createHydratedRoutes(payload.matches, payload.rendered),
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
									// cachedPatches.clear();
									// cachedRoutes.clear();
									const keep = new Set(matches.map((m) => m.route.id));
									for (const [key, cache] of cachedRoutes.entries()) {
										if (!keep.has(key)) {
											cache.outdated = true;
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
									cacheRoutes(Object.values(payload.rendered));
									return payload.actionData?.[id];
								});
							};

							const results = await Promise.all(
								matchesToLoad.map(async (match) => {
									const result = await match.resolve(async () => {
										const routeCache = cachedRoutes.get(match.route.id);
										const cachedRoute = routeCache?.get(match.pathname);
										if (!cachedRoute) {
											throw new Error("No server render for " + match.route.id);
										}

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
							throw new Error("Fetchers not yet implemented.");
						}

						const matchesToLoad = matches.filter((m) => m.shouldLoad);

						const missingMatches = new Set(
							matches
								.filter((match) => {
									const routeCache = cachedRoutes.get(match.route.id);
									return routeCache?.outdated;
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
							).then(async (response) => {
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
							});
						}

						const results = await Promise.all(
							matchesToLoad.map(async (match) => {
								const routeCache = cachedRoutes.get(match.route.id);
								const cachedRoute = routeCache?.get(match.pathname);
								if (!cachedRoute) {
									// TODO: Re-fetch the route
									throw new Error("No server render for " + match.route.id);
								}

								const serverLoaderData = callServerPromise
									? callServerPromise.then(
											(payload) => payload.loaderData[match.route.id],
										)
									: (cachedRoute.props.element ?? cachedRoute.props.children)
											.props.loaderData;

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
											serverLoader: async () => serverLoaderData,
										});
									}

									return loaderData;
								});
								return result;
							}),
						);

						const r = results.reduce(
							(acc, result, i) =>
								Object.assign(acc, {
									[matchesToLoad[i].route.id]: result,
								}),
							{},
						);
						return r;
					},
				});
			}
			return browserRouter;
		}
		return UNSAFE_createRouter({
			history: createServerHistory(payload.url),
			hydrationData: {
				actionData: payload.actionData,
				errors: payload.errors,
				loaderData: payload.loaderData,
			},
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
