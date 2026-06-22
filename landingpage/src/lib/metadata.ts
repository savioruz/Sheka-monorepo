/** Site-wide SEO config + per-page metadata resolution. Consumed by `<SEO>`. */

export interface PageMeta {
	title?: string;
	description?: string;
	keywords?: string[];
	image?: string;
	type?: 'website' | 'article';
	noindex?: boolean;
	canonical?: string;
}

const SITE_URL = (
	(import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://sheka.xyz'
).replace(/\/$/, '');

export const siteConfig = {
	name: 'Sheka',
	titleTemplate: '%s · Sheka',
	defaultTitle: 'Sheka — AI prediction markets that show their work',
	description:
		'Sheka pairs a live AI analyst with verifiable, self-custody prediction markets on Sui — ' +
		'sports and crypto, in one app. Every AI call is logged and verifiable on-chain.',
	keywords: [
		'Sheka',
		'Sui',
		'prediction market',
		'AI',
		'on-chain',
		'Walrus',
		'Seal',
		'sports',
		'crypto',
		'DeepBook'
	],
	author: 'Sheka',
	url: SITE_URL,
	ogImage: '/og.png',
	locale: 'en_US',
	themeColor: '#ffffff',
	twitter: '', // e.g. '@sheka'
	// Search-console verification — fill when available.
	googleVerification: '',
	yandexVerification: '',
	// Social profiles for the Organization JSON-LD — fill when available.
	sameAs: [] as string[]
};

export interface ResolvedMeta {
	title: string;
	description: string;
	keywords: string;
	author: string;
	robots: string;
	indexable: boolean;
	canonical: string;
	image: string;
	type: string;
	siteName: string;
	locale: string;
	twitter: string;
	themeColor: string;
	googleVerification: string;
	yandexVerification: string;
	jsonLd: Record<string, unknown>;
}

function toAbsolute(path: string, base: string): string {
	if (/^https?:\/\//.test(path)) return path;
	return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Merge per-page overrides with `siteConfig` into fully-resolved, absolute values.
 * Canonical is built from the site URL + the route's pathname so it stays correct
 * under prerendering (where `page.url.origin`/`href` are placeholders).
 */
export function resolveMeta(pathname: string, o: PageMeta = {}): ResolvedMeta {
	const base = siteConfig.url;
	const title = o.title ? siteConfig.titleTemplate.replace('%s', o.title) : siteConfig.defaultTitle;
	const description = o.description ?? siteConfig.description;
	const canonical = o.canonical ?? `${base}${pathname}`;
	const image = toAbsolute(o.image ?? siteConfig.ogImage, base);

	const website = {
		'@type': 'WebSite',
		name: siteConfig.name,
		url: base,
		description
	};
	const organization: Record<string, unknown> = {
		'@type': 'Organization',
		name: siteConfig.name,
		url: base,
		logo: toAbsolute('/logo.png', base)
	};
	if (siteConfig.sameAs.length > 0) organization.sameAs = siteConfig.sameAs;

	return {
		title,
		description,
		keywords: (o.keywords ?? siteConfig.keywords).join(', '),
		author: siteConfig.author,
		robots: o.noindex ? 'noindex, nofollow' : 'index, follow',
		indexable: !o.noindex,
		canonical,
		image,
		type: o.type ?? 'website',
		siteName: siteConfig.name,
		locale: siteConfig.locale,
		twitter: siteConfig.twitter,
		themeColor: siteConfig.themeColor,
		googleVerification: siteConfig.googleVerification,
		yandexVerification: siteConfig.yandexVerification,
		jsonLd: {
			'@context': 'https://schema.org',
			'@graph': [website, organization]
		}
	};
}
