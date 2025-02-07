import { h, type ComponentType, type VNode } from "preact";
import { renderToStringAsync } from "preact-render-to-string";
import {
	decode,
	type DecodeClientReferenceFunction,
	type DecodeServerReferenceFunction,
} from "preact-server-components";

import type { ServerPayload } from "./server.ts";

export type HandleRequestOptions = {
	assets: string[];
	decodeClientReference: DecodeClientReferenceFunction<any>;
	decodeServerReference: DecodeServerReferenceFunction;
	SERVER: { fetch(request: Request): Promise<Response> };
};

export async function handleRequest(
	request: Request,
	Wrapper: ComponentType<{ children: VNode }>,
	{
		assets,
		decodeClientReference,
		decodeServerReference,
		SERVER,
	}: HandleRequestOptions,
): Promise<Response> {
	const serverResponse = await SERVER.fetch(request);
	if (!serverResponse.body) {
		throw new Error("Server response has no body");
	}
	const [payloadStreamA, payloadStreamB] = serverResponse.body
		.pipeThrough(new TextDecoderStream())
		.tee();
	const [payload, inlinePayload] = await Promise.all([
		decode<ServerPayload>(payloadStreamA, {
			decodeClientReference,
			decodeServerReference,
		}),
		readToText(payloadStreamB),
	]);

	const body = await renderToStringAsync(
		h(
			Wrapper,
			null,
			payload.root,
			...assets.map((asset: string) =>
				h("script", { key: asset, type: "module", src: asset }),
			),
			h("script", {
				dangerouslySetInnerHTML: {
					__html: `window.__PREACT_STREAM__ = new ReadableStream({ start(c) { c.enqueue(${escapeHtml(JSON.stringify(inlinePayload))}); c.close(); } });`,
				},
			}),
		),
	);

	const headers = new Headers(serverResponse.headers);
	headers.set("content-type", "text/html");
	return new Response(body, {
		headers,
		status: serverResponse.status,
	});
}

async function readToText(stream: ReadableStream<string>) {
	let result = "";
	let reader = stream.getReader();
	try {
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
}

// This escapeHtml utility is based on https://github.com/zertosh/htmlescape
// License: https://github.com/zertosh/htmlescape/blob/0527ca7156a524d256101bb310a9f970f63078ad/LICENSE

// We've chosen to inline the utility here to reduce the number of npm dependencies we have,
// slightly decrease the code size compared the original package and make it esm compatible.

const ESCAPE_LOOKUP: { [match: string]: string } = {
	"&": "\\u0026",
	">": "\\u003e",
	"<": "\\u003c",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

function escapeHtml(html: string) {
	return html.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
}
