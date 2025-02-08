import { Link, type ShouldRevalidateFunctionArgs } from "react-router";

import type { Route } from "./+types/_index";

export function shouldRevalidate({
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	console.log("shouldRevalidate", defaultShouldRevalidate);
	return defaultShouldRevalidate;
}

export function loader({ params }: Route.LoaderArgs) {
	return {
		planet: <Link to="/products/world?test=1">world</Link>,
		other: "test",
		fn: () => 1,
	};
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
	console.log("clientLoader");
	const serverData = await serverLoader();

	return {
		...serverData,
		other: serverData.other.toUpperCase(),
	};
}

export default function Index({ loaderData }: Route.ComponentProps) {
	return (
		<>
			<h1>Hello, {loaderData.planet}!</h1>
			<p>{loaderData.other}</p>
		</>
	);
}
