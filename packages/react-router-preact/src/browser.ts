import { h, type VNode } from "preact";
import { Suspense } from "preact/compat";
import { hydrateRoot } from "preact/compat/client";
import { useState, useEffect } from "preact/hooks";
import {
	decode,
	type DecodeClientReferenceFunction,
	type DecodeServerReferenceFunction,
} from "preact-server-components";

import type { ServerPayload } from "./server.ts";

declare global {
	interface Window {
		__DECODE_CLIENT_REFERENCE__: DecodeClientReferenceFunction<any>;
		__DECODE_SERVER_REFERENCE__: DecodeServerReferenceFunction;
		__SET_PAYLOAD__?: (root: VNode<any>) => void;
		__PREACT_STREAM__: ReadableStream<string>;
	}
}

let hydrated = false;

function BrowserRoot({ initialPayload }: { initialPayload: VNode<any> }) {
	const [payload, _setPayload] = useState<{
		current: VNode<any>;
		last: VNode<any> | null;
	}>(() => ({
		current: initialPayload,
		last: null,
	}));

	useEffect(() => {
		hydrated = true;
	}, []);

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
	window.__DECODE_CLIENT_REFERENCE__ = decodeClientReference;
	window.__DECODE_SERVER_REFERENCE__ = decodeServerReference;

	const payloadStream = window.__PREACT_STREAM__;

	if (!payloadStream) throw new Error("No body");

	const payload = await decode<ServerPayload>(payloadStream, {
		decodeClientReference,
		decodeServerReference,
	});

	const html = {
		nodeType: 1,
		localName: "html",
		childNodes: document.documentElement.childNodes,
		firstChild: document.documentElement.firstChild,
		appendChild(n: any) {
			throw new Error("appendChild HTML");
		},
		insertBefore(n: any, c: any) {
			if (c.localName === "body") {
				document.body = n;
			}
		},
		contains(n: any) {
			return document.documentElement.contains(n);
		},
		setAttribute() {
			throw new Error("setAttribute HTML");
		},
	};

	hydrateRoot(
		{
			nodeType: 1,
			childNodes: [html],
			firstChild: html,
			appendChild(n: any) {
				if (n.localName === "html") {
					const [head, body] = n.childNodes;
					// document.head = head;
					if (body) document.body = body;
				} else {
					document.body.appendChild(n);
				}
			},
			insertBefore(n: any, c: any) {
				if (n.localName === "html") {
					this.appendChild(n);
					return;
				}
				if (!c) {
					document.body.innerHTML = "";
					document.body.appendChild(n);
				}
			},
			contains(n: any) {
				return n === html;
			},
			setAttribute(attr: string, value: string) {
				document.documentElement.setAttribute(attr, value);
			},
		} as any,
		h(BrowserRoot, { initialPayload: payload.root }),
	);
}
