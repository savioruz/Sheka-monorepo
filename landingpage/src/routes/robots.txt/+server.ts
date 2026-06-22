import { siteConfig } from '$lib/metadata';

export const prerender = true;

export function GET() {
	const body = `User-agent: *
Allow: /
Disallow: /under-construction

Sitemap: ${siteConfig.url}/sitemap.xml
`;
	return new Response(body, {
		headers: { 'Content-Type': 'text/plain' }
	});
}
