"use client";

import { h } from "preact";
import { useContext } from "preact/hooks";

import { Link, Outlet, UNSAFE_FrameworkContext } from "react-router";

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
	// return null;
}
