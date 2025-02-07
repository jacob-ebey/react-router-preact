Code:

- [ ] TODO: polyfills react-router ? might just be useable ?
- [ ] TODO: polyfills react-router/dom ? might just be useable ?

Docs:

- reactRouterNodeServer formats
  - ssr
  ```ts
  export default {
    fetch(request) {
      return new Response("Hello, world!");
    },
  };
  ```
  - server
  ```ts
  export default {
    async fetch(
      request: Request,
      { SERVER }: SSREnvironment
    ): Promise<Response> {
      return new Response("Hello, world!");
    },
  };
  ```
