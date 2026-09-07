import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CapturePage} from './pages/CapturePage';
import {BookmarkletPage} from './pages/BookmarkletPage';
import './index.css';

/**
 * เลือกหน้าจาก hash
 *
 * ระบบใช้แท็บไม่ได้ใช้ router — สองหน้านี้จึงแยกออกมาที่นี่แทนที่จะไปเพิ่มแท็บ
 * หน้า capture ต้องเบาที่สุดเพราะเป็นป๊อปอัปที่เด้งขึ้นมาแล้วปิดไปใน 10 วินาที
 * ถ้าให้มันโหลด App ทั้งตัวจะไปดึงเคสทั้งฐานข้อมูลมาโดยไม่ได้ใช้
 */
function Root() {
  const route = window.location.hash.replace(/^#/, '').split('?')[0];
  if (route === '/capture') return <CapturePage />;
  if (route === '/bookmarklet') return <BookmarkletPage />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
