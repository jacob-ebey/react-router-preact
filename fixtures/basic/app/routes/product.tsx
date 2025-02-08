import { useLoaderData } from "react-router";
import type { Route } from "./+types/product";

export function loader({ params }: Route.LoaderArgs) {
	return { name: `Super cool product #${params.id}` };
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
	const serverData = await serverLoader();

	return {
		...serverData,
		name: serverData.name.toUpperCase(),
	};
}

export default function Component({ loaderData }: Route.ComponentProps) {
	return <h1>{useLoaderData().name}</h1>;
}
