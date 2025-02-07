import { Link } from "react-router";

import type { Route } from "./+types/_index";

export function loader({ params }: Route.LoaderArgs) {
	return {
		planet: <Link to="/products/world">world</Link>,
		date: new Date(),
		fn: () => 1,
	};
}

export default function Index({ loaderData }: Route.ComponentProps) {
	return <h1>Hello, {loaderData.planet}!</h1>;
}
