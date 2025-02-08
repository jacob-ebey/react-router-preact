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

// @ts-expect-error
import { assets } from "virtual:preact-server-components/server";

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
};

export type RenderPayload = BaseServerPayload & {
	type: "render";
};

export type ActionPayload = BaseServerPayload & {
	type: "action";
	result: unknown;
};

export type ServerPayload = RenderPayload | ActionPayload;

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
	const routerPayload = await runServerRouter(request, routes, {
		basename,
		future,
		requestContext,
	});
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
	if (
		!ranReactRouterAction &&
		actionId &&
		request.method === "POST" &&
		request.body
	) {
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

		const payload: ActionPayload = {
			type: "action",
			result,
			root: router as any,
			url,
		};

		const payloadStream = encode(payload, {
			encodeClientReference,
			encodeServerReference,
			redactErrors,
		});
		return new Response(payloadStream.pipeThrough(new TextEncoderStream()), {
			headers: {
				"Content-Type": "text/x-component",
			},
		});
	}

	const payload: RenderPayload = {
		type: "render",
		root: router as any,
		url,
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
	rendered: DataRouteObject[];
	status: number;
	url: URL;
};

export type RouterPayload = RouterRedirectPayload | RouterRenderPayload;

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

	const renderedMatches = context.matches.map((match) => ({
		id: match.route.id,
		params: match.params,
		pathname: match.pathname,
		data: context.loaderData[match.route.id],
		handle: undefined,
	}));

	const routesManifest: UNSAFE_AssetsManifest["routes"] = {};
	let rendered: DataRouteObject[] = [];
	for (let i = (context.matches?.length ?? 0) - 1; i >= 0; i--) {
		const match = context.matches?.[i];
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

		rendered = match
			? [
					{
						id: match.route.id,
						caseSensitive: match.route.caseSensitive,
						index: match.route.index as false | undefined,
						path: match.route.path,
						children: match.route.index ? undefined : rendered,
						pathname: match.pathname,
						...(mod
							? {
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
									clientAction:
										mod.clientAction && h(mod.clientAction as any, null),
									clientLoader:
										mod.clientLoader && h(mod.clientLoader as any, null),
									clientShouldRevalidate:
										mod.shouldRevalidate &&
										h(mod.shouldRevalidate as any, null),
									hasErrorBoundary: mod.ErrorBoundary != null,
									HydrateFallback: mod.HydrateFallback,
									element: mod.Layout
										? h(
												mod.Layout as any,
												null,
												mod.default
													? h(mod.default as any, {
															params: match.params,
															loaderData: context.loaderData[match.route.id],
															actionData: context.actionData?.[match.route.id],
															matches: renderedMatches,
														})
													: h(Outlet as any, null),
											)
										: h(WrappedRoute, {
												element: mod.default
													? h(mod.default as any, {
															loaderData: context.loaderData[match.route.id],
															actionData: context.actionData?.[match.route.id],
														})
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
							: {}),
					} as DataRouteObject,
				]
			: rendered;
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
