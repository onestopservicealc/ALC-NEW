import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vite';
import { apiDevServer } from './vite-api-plugin';

// โหลด .env.local เข้า process.env เพื่อให้ /api/* ตอนพัฒนาอ่าน secret ฝั่งเซิร์ฟเวอร์ได้
// (Vite เปิดเผยเฉพาะตัวแปรที่ขึ้นต้นด้วย VITE_ ให้ฝั่ง client ซึ่งไม่พอสำหรับ handler)
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevServer()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
