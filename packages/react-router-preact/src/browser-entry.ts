import "preact/debug";
import { hydrate } from "react-router-preact/browser";
import {
	decodeClientReference,
	decodeServerReference,
} from "react-router-preact/vite.browser";

hydrate({
	decodeClientReference,
	decodeServerReference,
});
