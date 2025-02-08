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
	useParams,
	useRouteError,
	type DataRouteObject,
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

const cachedRoutes = new Map<string, Map<string, VNode<any>>>();
function cacheRoutes(rendered: DataRouteObject[]) {
	for (const route of rendered) {
		const cache = cachedRoutes.get(route.id) ?? new Map();
		cachedRoutes.set(route.id, cache);
		cache.set(
			(route as unknown as { pathname: string }).pathname,
			route.element,
		);
		if (route.children) {
			cacheRoutes(route.children);
		}
	}
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

function createHydratedRoutes(rendered: DataRouteObject[]): DataRouteObject[] {
	const hydrated: DataRouteObject[] = [];
	for (const route of rendered) {
		const hydratedRoute = {
			...route,
			element: h(HydratedRoute, {
				id: route.id,
				pathname: (route as unknown as { pathname: string }).pathname,
			}),
		} as any;
		hydrated.push(hydratedRoute);
		if (route.children) {
			hydratedRoute.children = createHydratedRoutes(route.children);
		}
	}
	return hydrated;
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
			if (!browserRouter) {
				cacheRoutes(payload.rendered);
				browserRouter = createBrowserRouter(
					createHydratedRoutes(payload.rendered),
					{
						hydrationData: {
							actionData: payload.actionData,
							errors: payload.errors,
							loaderData: payload.loaderData,
						},
						async patchRoutesOnNavigation({ matches, patch, path }) {
							if (cachedPatches.has(path)) return;
							cachedPatches.add(path);

							// TODO: Take into account existing matches
							const url = new URL(path, window.location.origin);
							url.pathname += ".data";
							await fetch(url).then(async (response) => {
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
									cacheRoutes(payload.rendered);
									const patchRecursive = (
										routes = createHydratedRoutes(payload.rendered),
										id: string | null = null,
									) => {
										patch(id, routes);
										for (const route of routes) {
											if (route.children) {
												patchRecursive(route.children, route.id);
											}
										}
									};
									patchRecursive();
								}
							});
						},
						// dataStrategy({ fetcherKey, matches, params, request, context }) {
						// 	// TODO: Implement a data strategy to surface loader data through hooks.
						//  // right now you can access it through the component props, but becomes
						//  // out of sync with the client navigations. Also take into account shouldRevalidate,
						//  // and client loaders / actions
						// },
					},
				);
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
			routes: payload.rendered,
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
