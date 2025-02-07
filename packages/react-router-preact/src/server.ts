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
	type UNSAFE_RouteModules,
} from "react-router";

import { ClientRouter, Outlet, WrappedError } from "react-router-preact/client";

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

	const context = await handler.query(request, { requestContext });

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
		rendered = match
			? [
					{
						id: match.route.id,
						caseSensitive: match.route.caseSensitive,
						index: match.route.index as false | undefined,
						path: match.route.path,
						children: match.route.index ? undefined : rendered,
						...(mod
							? {
									hasErrorBoundary: mod.ErrorBoundary != null,
									HydrateFallback: mod.HydrateFallback,
									element:
										// h(
										// 	Suspense,
										// 	null,
										mod.default
											? h(mod.default as any, {
													params: match.params,
													loaderData: context.loaderData[match.route.id],
													actionData: context.actionData?.[match.route.id],
													matches: renderedMatches,
												})
											: h(Outlet as any, null),
									// ),
									// ErrorBoundary: mod.ErrorBoundary,
									errorElement:
										mod.ErrorBoundary &&
										h(WrappedError, {
											element: h(mod.ErrorBoundary as any, {
												error: new Error("unknown"),
											}),
										}),
								}
							: {}),
					} as DataRouteObject,
				]
			: rendered;
	}

	return {
		type: "render",
		actionData: context.actionData,
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
