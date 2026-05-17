import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('recharts')) return 'charts';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@capacitor') || id.includes('@capgo/capacitor-native-biometric')) return 'capacitor';
          if (id.includes('date-fns')) return 'date-utils';
          if (id.includes('react')) return 'react-vendor';
        },
      },
    },
  },
})
