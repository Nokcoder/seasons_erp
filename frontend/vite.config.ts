import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' 

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <-- YOU MISSED THIS PART!
  ],
  server: {
    port: 8080,
    strictPort: true, 
  }
})