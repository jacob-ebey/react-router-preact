import { handleRequest } from "react-router-preact/server";
import {
	encodeClientReference,
	encodeServerReference,
	loadServerReference,
} from "react-router-preact/vite.server";

// @ts-expect-error
import routes from "virtual:react-router-preact/server-routes";

export default {
	async fetch(request: Request): Promise<Response> {
		return handleRequest(request, routes, {
			redactErrors: !import.meta.env.DEV,
			encodeClientReference,
			encodeServerReference,
			loadServerReference,
		});
	},
};
