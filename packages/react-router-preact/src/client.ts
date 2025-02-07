"use client";

import { h, type VNode } from "preact";
import {
	createBrowserRouter,
	createPath,
	NavigationType,
	Outlet,
	RouterProvider,
	UNSAFE_createRouter,
	useRouteError,
	type To,
} from "react-router";

import { useMemo } from "preact/hooks";
import type { RouterRenderPayload } from "./server.ts";

export { Outlet };

export function WrappedError({ element }: { element: VNode<any> }) {
	const error = useRouteError();
	element.props.error = error;
	return element;
}

export function ClientRouter({
	payload,
}: {
	payload: RouterRenderPayload;
}) {
	const router = useMemo(() => {
		if (typeof document !== "undefined") {
			return createBrowserRouter(payload.rendered, {
				hydrationData: {
					actionData: payload.actionData,
					errors: payload.errors,
					loaderData: payload.loaderData,
				},
			});
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

	return h(RouterProvider, { router });
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
