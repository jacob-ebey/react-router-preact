import type {
	ClientReference,
	EncodeClientReferenceFunction,
	EncodeServerReferenceFunction,
	ServerReference,
} from "preact-server-components";

// @ts-expect-error
import { loadServerReference as virtualLoadServerReference } from "virtual:preact-server-components/server";

export function loadServerReference(referenceId: string): Promise<unknown> {
	if (import.meta.env.DEV) {
		if (referenceId.startsWith("/\x00server-route:")) {
			referenceId = referenceId.slice("/\x00server-route:".length);
		}
	}
	return virtualLoadServerReference(referenceId);
}

type ClientReferenceImp = ClientReference & {
	$$id: string;
	$$name: string;
	$$chunks?: string[];
};

export type EncodedClientReference = [
	id: string,
	name: string,
	...chunks: string[],
];

export const encodeClientReference: EncodeClientReferenceFunction<
	ClientReferenceImp,
	EncodedClientReference
> = (reference) => {
	if (!reference.$$id || !reference.$$name) {
		throw new Error("Client reference must have $$id and $$name properties");
	}
	return [reference.$$id, reference.$$name, ...(reference.$$chunks ?? [])];
};

type ServerReferenceImp = ServerReference & {
	$$id: string;
	$$name: string;
};

export const encodeServerReference: EncodeServerReferenceFunction<
	ServerReferenceImp
> = (reference) => {
	if (!reference.$$id || !reference.$$name) {
		throw new Error("Client reference must have $$id and $$name properties");
	}
	return `${reference.$$id}#${reference.$$name}`;
};
