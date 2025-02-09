"use client";

import { h } from "preact";
import { useContext } from "preact/hooks";

import {
	Form as RRForm,
	Link,
	Outlet,
	UNSAFE_FrameworkContext,
	type FormProps as RRFormProps,
} from "react-router";

export * from "react-router";

export { Link, Outlet };

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

export type FormProps = Omit<RRFormProps, "action"> & {
	action?: string | ((formData: FormData) => void | Promise<void>);
};

export function Form({action,...props}: FormProps) {
	if (!action || typeof action === "string") {
		return h(RRForm, { action, ...props });
	}

	return null;
}
