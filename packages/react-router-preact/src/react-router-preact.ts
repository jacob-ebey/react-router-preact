"use client";

import { h, type VNode } from "preact";
import type { ServerReference } from "preact-server-components";
import { useContext } from "preact/hooks";

import {
	Form as RRForm,
	Link,
	Outlet,
	UNSAFE_FrameworkContext,
	type FormProps,
} from "react-router";

export * from "react-router";

export { Link, Outlet };

const SERVER_REFERENCE = Symbol.for("preact.server.reference");

export function Scripts() {
	const ctx = useContext(UNSAFE_FrameworkContext as any) as any;
	const scripts = new Set([
		ctx.manifest.entry.module,
		...ctx.manifest.entry.imports,
	]);

	return Array.from(scripts).map((src) =>
		h("script", { key: src, type: "module", src }),
	);
}

declare module "react-router" {
	export interface FormProps {
		action?: string | ((formData: FormData) => void | Promise<void>);
	}
}

export function Form({
	action,
	children,
	method,
	onSubmit,
	...props
}: FormProps) {
	if (!action || typeof action === "string") {
		return h(RRForm as any, { ...props, action, method, onSubmit }, children);
	}

	const hidden: VNode<any>[] = [];

	const serverAction = action as unknown as ServerReference & {
		$$id: string;
		$$name: string;
	};
	if (serverAction.$$typeof === SERVER_REFERENCE) {
		hidden.push(
			h("input", {
				type: "hidden",
				name: "__preact-action",
				value: serverAction.$$id + "#" + serverAction.$$name,
			}),
		);
	}

	return h(
		"form",
		{
			...props,
			method: "post",
			encType: "multipart/form-data",
			onSubmit: (event: SubmitEvent) => {
				const formData = new FormData(
					event.currentTarget as HTMLFormElement,
					event.submitter,
				);
				if (typeof action === "function") {
					action(formData);
				} else {
					if (!window.__CALL_SERVER__) {
						throw new Error("Server action not supported");
					}
					window.__CALL_SERVER__(
						serverAction.$$id + "#" + serverAction.$$name,
						[formData],
					);
				}
				event.preventDefault();
			},
		},
		...hidden,
		children,
	);
}
