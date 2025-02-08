import { handleRequest } from "react-router-preact/ssr";
import {
	decodeClientReference,
	decodeServerReference,
} from "react-router-preact/vite.ssr";

export interface SSREnvironment {
	SERVER: { fetch(request: Request): Promise<Response> };
}

export default {
	async fetch(request: Request, { SERVER }: SSREnvironment): Promise<Response> {
		if (import.meta.env.DEV) {
			console.log(request.method, request.url);
		}
		return handleRequest(request, {
			decodeClientReference,
			decodeServerReference,
			SERVER,
		});
	},
};
