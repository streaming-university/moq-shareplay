import { defineConfig } from "astro/config"
import tailwind from "@astrojs/tailwind"
import mdx from "@astrojs/mdx"
import solidJs from "@astrojs/solid-js"
import nodejs from "@astrojs/node"
import mkcert from "vite-plugin-mkcert"
import crossOriginIsolation from "vite-plugin-cross-origin-isolation"

// https://astro.build/config
export default defineConfig({
	integrations: [
		mdx(),
		solidJs(),
		tailwind({
			applyBaseStyles: false,
		}),
	],
	adapter: nodejs({
		mode: "standalone",
	}),
	output: 'server',
	vite: {
		server: {
			https: true,
			hmr: {
				clientPort: 443,
				protocol: 'wss',
				host: 'shareplay.streaming.university',
			},
		},
		plugins: [
			mkcert(),
			crossOriginIsolation(),
		],
		resolve: {
			alias: {
				"@": "/src",
			},
		},
	},
	trailingSlash: "never",
})
