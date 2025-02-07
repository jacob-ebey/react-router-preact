import { h, type ComponentChildren } from "preact";
import { handleRequest } from "react-router-preact/ssr";
import {
	decodeClientReference,
	decodeServerReference,
} from "react-router-preact/vite.ssr";

// @ts-expect-error
import { assets } from "virtual:preact-server-components/client";

export interface SSREnvironment {
	SERVER: { fetch(request: Request): Promise<Response> };
}

function Document({ children }: { children: ComponentChildren }) {
	return h(
		"html",
		null,
		h("head", null),
		h("body", null, h("div", { id: "app" }, children)),
	);
}

export default {
	async fetch(request: Request, { SERVER }: SSREnvironment): Promise<Response> {
		if (import.meta.env.DEV) {
			console.log(request.method, request.url);
		}
		return handleRequest(request, Document, {
			assets,
			decodeClientReference,
			decodeServerReference,
			SERVER,
		});
	},
};
