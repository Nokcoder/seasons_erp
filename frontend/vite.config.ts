import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' 

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(), // <-- YOU MISSED THIS PART!
  ],
  server: {
    port: 8080,
    strictPort: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
}))