import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import NotificationBell from '../NotificationBell';
import styles from './MainLayout.module.css';

export interface MainLayoutProps {
  children: ReactNode;
  currentUser?: any;
  onLogout?: () => void;
}

export function MainLayout({
  children,
  currentUser,
  onLogout,
}: MainLayoutProps) {
  return (
    <div className={styles.layoutContainer}>
      <Sidebar
        currentUser={currentUser}
        onLogout={onLogout}
      />

      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0' }}>
            <NotificationBell />
          </div>

          {children}
        </div>

        <footer className={styles.footer}>
          智能发票报销管理系统 ©2026 by Gavin.
        </footer>
      </main>
    </div>
  );
}

// 兼容默认导出，以防你的 index.ts 需要
export default MainLayout;