import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    const define: Record<string, any> = {};
    if (env.GEMINI_API_KEY) {
        define['process.env.GEMINI_API_KEY'] = JSON.stringify(env.GEMINI_API_KEY);
    }
    if (env.API_KEY) {
        define['process.env.API_KEY'] = JSON.stringify(env.API_KEY);
    }
    if (env.MY_GEMINI_API_KEY) {
        define['process.env.MY_GEMINI_API_KEY'] = JSON.stringify(env.MY_GEMINI_API_KEY);
    }

    if (env.VITE_GEMINI_API_KEY) {
        define['process.env.VITE_GEMINI_API_KEY'] = JSON.stringify(env.VITE_GEMINI_API_KEY);
    }

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.MY_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
        
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
