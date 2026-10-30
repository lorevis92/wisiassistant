import { defineConfig, loadEnv } from 'vite'

// Builds the embeddable widget as a single IIFE file: dist/widget.js
// Clients embed it with:
// <script src="https://YOUR-VERCEL-DOMAIN/widget.js" data-client="CLIENT_SLUG" async></script>
// The Supabase URL / anon key are baked in at build time from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    esbuild: { charset: 'ascii' }, // keep the widget pure ASCII: client sites may lack <meta charset>
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: 'widget/widget.js',
        name: 'WisiAssistant',
        formats: ['iife'],
        fileName: () => 'widget.js',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
      minify: true,
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __WA_SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''),
      __WA_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''),
    },
  }
})
