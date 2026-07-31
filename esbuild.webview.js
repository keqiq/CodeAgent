const esbuild = require("esbuild");
const fs = require("fs");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
	if (!fs.existsSync('dist')) {
        fs.mkdirSync('dist');
    }
    fs.copyFileSync('src/webview/frontend.html', 'dist/frontend.html');
	const ctx = await esbuild.context({
		entryPoints: [
			'src/webview/frontend.ts'
		],
		bundle: true,
		format: 'iife', // Standard for browser scripts
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outfile: 'dist/webview.bundle.js',
		logLevel: 'silent',
		// Prevent node-specific errors in the browser
		define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
        plugins: [{
			name: 'webview-watch-logger',
			setup(build) {
				build.onEnd(result => {
					if (result.errors.length > 0) {
						console.error('✘ [ERROR] Webview build failed');
					} else if (watch) {
						console.log('[watch] Webview built successfully');
					}
				});
			}
		}]
	});

	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});