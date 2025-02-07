import type { ComponentType } from "preact";
import { lazy } from "preact/compat";
import type {
	DecodeClientReferenceFunction,
	DecodeServerReferenceFunction,
} from "preact-server-components";

// @ts-expect-error
import { loadClientReference } from "virtual:preact-server-components/client";

import type { EncodedClientReference } from "./vite.server.ts";

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
	const cached = import.meta.env.PROD && cache.get(key);
	if (cached) {
		return cached;
	}
	const Comp = lazy(() =>
		loadClientReference(encoded).then((Component: any) => ({
			default: Component,
		})),
	) as ComponentType;
	cache.set(key, Comp);
	return Comp;
};

export const decodeServerReference: DecodeServerReferenceFunction = () => {
	return () => {
		throw new Error("Server references are not supported during prerendering");
	};
};
