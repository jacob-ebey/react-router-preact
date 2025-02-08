import type { ComponentType, VNode } from "preact";
import { lazy } from "preact/compat";
import {
	decode,
	encode,
	type DecodeClientReferenceFunction,
	type DecodeServerReferenceFunction,
} from "preact-server-components";

// @ts-expect-error
import { loadClientReference } from "virtual:preact-server-components/client";

import type { ActionPayload } from "./server.ts";
import type { EncodedClientReference } from "./vite.server.ts";

declare global {
	interface Window {
		__SET_PAYLOAD__?: (root: VNode<any>) => void;
	}
}

const cache = new Map<string, ComponentType>();

export const decodeClientReference: DecodeClientReferenceFunction<
	EncodedClientReference
> = (encoded) => {
	if (import.meta.env.DEV) {
		const id = encoded[0];
		if (id.startsWith("\x00client-route:")) {
			encoded[0] = id.slice("\x00client-route:".length);
		}
	}

	const key = `${encoded[0]}:${encoded[1]}`;
	const cached = import.meta.env.PROD ? cache.get(key) : undefined;
	if (cached) {
		return cached;
	}
	const Comp = lazy(() =>
		loadClientReference(encoded).then((Component: any) => ({
			default: Component,
		})),
	) as ComponentType & { raw: () => Promise<unknown> };
	Comp.raw = () => loadClientReference(encoded);
	cache.set(key, Comp);
	return Comp;
};

export const decodeServerReference: DecodeServerReferenceFunction = (id) => {
	return async (...args: unknown[]) => {
		const encoded = encode(args);
		const body =
			window.location.protocol !== "https:"
				? await readToString(encoded)
				: encoded.pipeThrough(new TextEncoderStream());
		const response = await fetch(window.location.href, {
			body,
			headers: {
				accept: "text/x-component",
				"content-type": "text/x-component",
				"psc-action": id,
			},
			method: "POST",
			duplex: "half",
		} as RequestInit & { duplex: "half" });
		if (!response.body) throw new Error("No body");
		const payload = await decode<ActionPayload>(
			response.body.pipeThrough(new TextDecoderStream()),
			{
				decodeClientReference,
				decodeServerReference,
			},
		);

		Promise.resolve(payload.root).then((root) =>
			window.__SET_PAYLOAD__?.(root),
		);

		return payload.result;
	};
};

const readToString = async (stream: ReadableStream<string>) => {
	const reader = stream.getReader();
	try {
		let result = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			result += value;
		}
		return result;
	} finally {
		reader.releaseLock();
	}
};
