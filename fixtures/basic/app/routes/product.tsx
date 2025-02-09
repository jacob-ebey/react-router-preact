import { Form } from "react-router";
import type { Route } from "./+types/product";

import { getMutations, incrementMutations } from "~/api";

export function loader({ params }: Route.LoaderArgs) {
	return {
		name: `Super cool product #${params.id}`,
		mutations: getMutations(),
	};
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
	const serverData = await serverLoader();

	return {
		...serverData,
		name: serverData.name.toUpperCase(),
	};
}

export function action({ params }: Route.ActionArgs) {
	incrementMutations();
	return {
		mutated: "YAY!",
	};
}

export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	await serverAction();
	return {
		mutated: "CLIENT!",
	};
}

export default function Component({
	actionData,
	loaderData,
}: Route.ComponentProps) {
	return (
		<>
			<h1>{loaderData.name}</h1>
			<p>Mutations: {loaderData.mutations}</p>
			<Form method="post">
				<input type="text" name="name" />
				<button type="submit">Submit</button>
			</Form>
			<pre>{JSON.stringify(actionData, null, 2)}</pre>
		</>
	);
}

export function HydrateFallback({ params }: Route.HydrateFallbackProps) {
	return <h1>Loading product {params.id}...</h1>;
}
