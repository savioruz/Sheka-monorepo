// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}

		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** Per-page SEO overrides consumed by <SEO> in the root layout. */
			meta?: import('$lib/metadata').PageMeta;
		}
		// interface PageState {}
	}
}

export {};
