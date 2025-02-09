import { Fragment, h } from "preact";
import { renderToStringAsync } from "preact-render-to-string";
import {
	decode,
	type DecodeClientReferenceFunction,
	type DecodeServerReferenceFunction,
} from "preact-server-components";

import type { ServerPayload } from "./server.ts";

export type HandleRequestOptions = {
	decodeClientReference: DecodeClientReferenceFunction<any>;
	decodeServerReference: DecodeServerReferenceFunction;
	SERVER: { fetch(request: Request): Promise<Response> };
};

export async function handleRequest(
	request: Request,
	{
		decodeClientReference,
		decodeServerReference,
		SERVER,
	}: HandleRequestOptions,
): Promise<Response> {
	const url = new URL(request.url);
	const isDataRequest = url.pathname.endsWith(".data");
	let serverRequest = request;
	if (isDataRequest) {
		const targetURL = new URL(request.url);
		targetURL.pathname = targetURL.pathname.slice(0, -".data".length);
		serverRequest = new Request(targetURL, {
			body: request.body,
			duplex: request.body ? "half" : undefined,
			headers: request.headers,
			method: request.method,
			signal: request.signal,
		} as RequestInit & { duplex?: "half" });
	}
	const serverResponse = await SERVER.fetch(serverRequest);

	if (isDataRequest || request.headers.get("accept") === "text/x-component") {
		return serverResponse;
	}

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

	const body = await renderToStringAsync(h(Fragment, null, payload.root));

	let inlineScript = `<script>window.__PREACT_STREAM__ = new ReadableStream({ start(c) { c.enqueue(${escapeHtml(JSON.stringify(inlinePayload))}); c.close(); } });</script>`;

	const headers = new Headers(serverResponse.headers);
	headers.set("content-type", "text/html");
	return new Response("<!DOCTYPE html>" + body + inlineScript, {
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
