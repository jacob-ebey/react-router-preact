import { h, type VNode } from "preact";
import {
	decode,
	encode,
	type EncodeClientReferenceFunction,
	type EncodeServerReferenceFunction,
} from "preact-server-components";
import {
	createStaticHandler,
	matchRoutes,
	type DataRouteObject,
	type UNSAFE_AssetsManifest,
	type UNSAFE_RouteModules,
} from "react-router";

import {
	ClientRouter,
	Outlet,
	WrappedError,
	WrappedRoute,
} from "react-router-preact/client";

import {
	assets,
	loadServerReference,
	// @ts-expect-error
} from "virtual:preact-server-components/server";

export type HandleRequestOptions = {
	basename?: string;
	future?: { [k: string]: never };
	redactErrors?: boolean | string;
	requestContext?: unknown;
	encodeClientReference: EncodeClientReferenceFunction<any, any>;
	encodeServerReference: EncodeServerReferenceFunction<any>;
	loadServerReference: (referenceId: string) => Promise<unknown>;
};

export type BaseServerPayload = {
	root: VNode;
	url: URL;
	result?: Promise<unknown>;
};

export type RenderPayload = BaseServerPayload & {
	type: "render";
};

export type ServerPayload = RenderPayload;

export async function handleRequest(
	request: Request,
	routes: DataRouteObject[],
	{
		basename,
		future,
		redactErrors,
		requestContext,
		encodeClientReference,
		encodeServerReference,
		loadServerReference,
	}: HandleRequestOptions,
) {
	let result: Promise<unknown> | undefined;
	if (
		request.method === "POST" &&
		request.headers.get("content-type")?.match(/\bmultipart\/form-data\b/)
	) {
		const formData = await request.formData();
		const actionId = formData.get("__preact-action");
		if (typeof actionId === "string") {
			formData.delete("__preact-action");
			const reference = (await loadServerReference(actionId)) as (
				...args: unknown[]
			) => unknown;

			result = (async () => reference(formData))();
			try {
				await result;
			} catch {}

			request = new Request(request.url, {
				headers: request.headers,
				signal: request.signal,
			});
		} else {
			request = new Request(request.url, {
				body: formData,
				headers: request.headers,
				method: request.method,
				signal: request.signal,
			});
		}
	} else if (
		request.method === "POST" &&
		request.headers.get("psc-action") &&
		request.body
	) {
		const actionId = request.headers.get("psc-action") || "";

		const reference = (await loadServerReference(actionId)) as (
			...args: unknown[]
		) => unknown;
		const args = await decode<unknown[]>(
			request.body.pipeThrough(new TextDecoderStream()),
		);
		const result = (async () => reference(...args))();
		try {
			await result;
		} catch {}

		request = new Request(request.url, {
			headers: request.headers,
			signal: request.signal,
		});
	}

	const routerPayload = await runServerRouter(request, routes, {
		basename,
		future,
		requestContext,
	});

	if (routerPayload.type === "fetcher") {
		const payloadStream = encode(routerPayload.promise, {
			encodeClientReference,
			encodeServerReference,
			redactErrors,
		});
		return new Response(payloadStream.pipeThrough(new TextEncoderStream()), {
			status: 200,
			headers: {
				"Content-Type": "text/x-component",
				Vary: "content-type",
			},
		});
	}

	const ranReactRouterAction =
		routerPayload.type === "render" &&
		Object.keys(routerPayload.actionData ?? {}).length > 0;

	const router =
		routerPayload.type === "redirect"
			? null
			: h(ClientRouter, { payload: routerPayload });

	const url = new URL(request.url);

	const actionId = request.headers.get("psc-action");
	if (ranReactRouterAction && actionId) {
		console.log(
			"Tried to call both React Router and Preact Server Component actions",
		);
	}

	const payload: RenderPayload = {
		type: "render",
		root: router as any,
		url,
		result,
	};

	const payloadStream = encode(payload, {
		encodeClientReference,
		encodeServerReference,
		redactErrors,
	});
	return new Response(payloadStream.pipeThrough(new TextEncoderStream()), {
		status: routerPayload.type === "render" ? routerPayload.status : 200,
		headers: {
			"Content-Type": "text/x-component",
			Vary: "content-type",
		},
	});
}

export type RouterRedirectPayload = {
	type: "redirect";
	location: string;
	url: URL;
};

export type RouterRenderPayload = {
	type: "render";
	actionData: Record<string, unknown> | null;
	errors: Record<string, unknown> | null;
	loaderData: Record<string, unknown>;
	manifest: UNSAFE_AssetsManifest;
	matches: { id: string }[];
	rendered: Record<string, DataRouteObject & { pathname: string }>;
	status: number;
	url: URL;
};

export type RouterFetcherPayload = {
	type: "fetcher";
	promise: Promise<unknown>;
};

export type RouterPayload =
	| RouterRedirectPayload
	| RouterRenderPayload
	| RouterFetcherPayload;

export async function runServerRouter(
	request: Request,
	routes: DataRouteObject[],
	{
		basename,
		future,
		requestContext,
	}: {
		basename?: string;
		future?: { [k: string]: never };
		requestContext?: unknown;
	} = {},
): Promise<RouterPayload> {
	const url = new URL(request.url);
	let matches = matchRoutes(routes, url.pathname, basename);
	let status = 200;

	if (!matches?.length) {
		status = 404;
		matches = [
			{
				params: {},
				pathname: url.pathname,
				pathnameBase: "/",
				route: routes[0],
			},
		];
	}

	let serverRoutes: DataRouteObject[] = [];
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches?.[i];
		const mod = await (
			match?.route as unknown as
				| {
						import: () => Promise<UNSAFE_RouteModules[string]>;
				  }
				| undefined
		)?.import();
		if (serverRoutes) {
			for (const route of serverRoutes) {
				(route as any).parentId = match.route.id;
			}
		}

		serverRoutes = match
			? [
					{
						import: (match.route as any).import,
						id: match.route.id,
						caseSensitive: match.route.caseSensitive,
						index: match.route.index as false | undefined,
						path: match.route.path,
						children: match.route.index ? undefined : serverRoutes,
						...(mod
							? {
									// ...mod,
									action: "action" in mod ? (mod?.action as any) : undefined,
									hasErrorBoundary: mod?.ErrorBoundary != null,
									HydrateFallback: mod?.HydrateFallback,
									loader: "loader" in mod ? (mod?.loader as any) : undefined,
								}
							: {}),
					} as DataRouteObject,
				]
			: serverRoutes;
	}

	const handler = createStaticHandler(serverRoutes, { basename, future });

	const requestedRoute = url.searchParams.get("_route");
	if (requestedRoute) {
		return {
			type: "fetcher",
			promise: handler.queryRoute(request, {
				routeId: requestedRoute,
				requestContext,
			}),
		};
	}

	// TODO: Should we should strip out the search params and other things that can't be prerendered?
	const urlThatCanBePrerendered = new URL(url.href);
	urlThatCanBePrerendered.search = "";
	urlThatCanBePrerendered.hash = "";

	const requestThatCanBePrerendered =
		request.method !== "GET" && request.method !== "HEAD"
			? new Request(urlThatCanBePrerendered, {
					headers: request.headers,
					method: request.method,
					signal: request.signal,
				} as RequestInit & { duplex?: "half" })
			: request;

	const context = await handler.query(requestThatCanBePrerendered, {
		requestContext,
	});

	if (isResponse(context)) {
		const location = context.headers.get("Location");
		if (!location || !isRedirectStatusCode(context.status)) {
			throw new Error("Invalid response");
		}
		return {
			type: "redirect",
			location,
			url,
		};
	}

	const routesManifest: UNSAFE_AssetsManifest["routes"] = {};
	let rendered: Record<string, DataRouteObject & { pathname: string }> = {};
	let last: DataRouteObject | undefined;
	for (let i = (context.matches?.length ?? 0) - 1; i >= 0; i--) {
		const match = context.matches?.[i];
		if (!match) throw new Error("No match");
		const mod = await (
			match?.route as unknown as
				| {
						import: () => Promise<UNSAFE_RouteModules[string]>;
				  }
				| undefined
		)?.import();

		routesManifest[match.route.id] = {
			hasAction: "action" in match.route && !!match.route.action,
			hasClientAction:
				"clientAction" in match.route && !!match.route.clientAction,
			hasClientLoader:
				"clientLoader" in match.route && !!match.route.clientLoader,
			hasErrorBoundary: mod?.ErrorBoundary != null,
			hasLoader: "loader" in match.route && !!match.route.loader,
			id: match.route.id,
			module: assets[0],
			caseSensitive: match.route.caseSensitive,
			css: undefined,
			imports: assets,
			index: match.route.index as false | undefined,
			parentId: (match.route as any).parentId,
			path: match.route.path,
		};

		last = rendered[match.route.id] = {
			id: match.route.id,
			caseSensitive: match.route.caseSensitive,
			index: match.route.index as false | undefined,
			path: match.route.path,
			children: match.route.index ? undefined : last ? [last] : undefined,
			pathname: match.pathname,
			...(mod
				? {
						hasAction: "action" in match.route && !!match.route.action,
						hasClientAction:
							"clientAction" in match.route && !!match.route.clientAction,
						hasClientLoader:
							"clientLoader" in match.route && !!match.route.clientLoader,
						hasLoader: "loader" in match.route && !!match.route.loader,

						action:
							("action" in mod && mod.action) ||
							("clientAction" in mod && mod.clientAction)
								? true
								: undefined,
						loader:
							("loader" in mod && mod.loader) ||
							("clientLoader" in mod && mod.clientLoader)
								? true
								: undefined,
						clientAction: mod.clientAction && h(mod.clientAction as any, null),
						clientLoader: mod.clientLoader && h(mod.clientLoader as any, null),
						clientShouldRevalidate:
							mod.shouldRevalidate && h(mod.shouldRevalidate as any, null),
						hasErrorBoundary: mod.ErrorBoundary != null,
						hydrateFallbackElement: mod.HydrateFallback
							? mod.Layout
								? h(
										mod.Layout as any,
										null,
										h(mod.HydrateFallback as any, { params: match.params }),
									)
								: h(mod.HydrateFallback as any, { params: match.params })
							: undefined,
						element: mod.Layout
							? h(
									mod.Layout as any,
									null,
									mod.default
										? h(WrappedRoute, {
												element: mod.default
													? h(mod.default as any, {})
													: h(Outlet as any, null),
											})
										: h(Outlet as any, null),
								)
							: h(WrappedRoute, {
									element: mod.default
										? h(mod.default as any, {})
										: h(Outlet as any, null),
								}),
						errorElement:
							mod.ErrorBoundary &&
							(mod.Layout
								? h(
										mod.Layout as any,
										null,
										h(WrappedError, {
											element: h(mod.ErrorBoundary as any, {}),
										}),
									)
								: h(WrappedError, {
										element: h(mod.ErrorBoundary as any, {}),
									})),
					}
				: {
						element: h(Outlet, null),
					}),
		} as DataRouteObject & { pathname: string };
	}

	return {
		type: "render",
		actionData: context.actionData,
		manifest: {
			entry: {
				imports: assets,
				module: assets[0],
			},
			url: "",
			version: "",
			routes: routesManifest,
		},
		errors: context.errors,
		loaderData: context.loaderData,
		rendered,
		matches: context.matches.map((match) => ({ id: match.route.id })),
		status: status > context.statusCode ? status : context.statusCode,
		url,
	};
}

function isResponse(value: any): value is Response {
	return (
		value != null &&
		typeof value.status === "number" &&
		typeof value.statusText === "string" &&
		typeof value.headers === "object" &&
		typeof value.body !== "undefined"
	);
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
function isRedirectStatusCode(statusCode: number): boolean {
	return redirectStatusCodes.has(statusCode);
}
