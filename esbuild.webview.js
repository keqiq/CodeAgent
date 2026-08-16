const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyStaticFiles() {
    if (!fs.existsSync('dist')) {
        fs.mkdirSync('dist', { recursive: true });
    }
    const chatHtmlSrc = path.join('src', 'webviews', 'chat', 'chatWebview.html');
	fs.copyFileSync(chatHtmlSrc, path.join('dist', 'chat.html'));


    const mcpHtmlSrc = path.join('src', 'webviews', 'mcp', 'mcpWebview.html');
	fs.copyFileSync(mcpHtmlSrc, path.join('dist', 'mcp.html'));
}

async function main() {
	copyStaticFiles();
  
	const entryPoints = {
        'chat.bundle': './src/webviews/chat/chatWebview.ts',
        'mcp.bundle': './src/webviews/mcp/mcpWebview.ts'
    };
	const ctx = await esbuild.context({
		entryPoints: entryPoints,
		bundle: true,
		format: 'iife', // Standard for browser scripts
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outdir: 'dist',
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