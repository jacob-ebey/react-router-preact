import { h, type VNode } from "preact";
import { Suspense } from "preact/compat";
import { hydrateRoot } from "preact/compat/client";
import { useState } from "preact/hooks";
import {
	decode,
	type DecodeClientReferenceFunction,
	type DecodeServerReferenceFunction,
} from "preact-server-components";

import type { ServerPayload } from "./server.ts";

declare global {
	interface Window {
		__SET_PAYLOAD__?: (root: VNode<any>) => void;
		__PREACT_STREAM__: ReadableStream<string>;
	}
}

function BrowserRoot({ initialPayload }: { initialPayload: VNode<any> }) {
	const [payload, _setPayload] = useState<{
		current: VNode<any>;
		last: VNode<any> | null;
	}>(() => ({
		current: initialPayload,
		last: null,
	}));

	window.__SET_PAYLOAD__ = (current: VNode<any>) => {
		_setPayload((last) => ({ current, last: last.current }));
	};

	return h(Suspense, { fallback: payload.last }, payload.current);
}

export async function hydrate({
	decodeClientReference,
	decodeServerReference,
}: {
	decodeClientReference: DecodeClientReferenceFunction<any>;
	decodeServerReference: DecodeServerReferenceFunction;
}) {
	const payloadStream = window.__PREACT_STREAM__;

	if (!payloadStream) throw new Error("No body");
	const payload = await decode<ServerPayload>(payloadStream, {
		decodeClientReference,
		decodeServerReference,
	});
	const app = document.getElementById("app");
	if (!app) throw new Error("No #app element");

	hydrateRoot(app, h(BrowserRoot, { initialPayload: payload.root }));
}
