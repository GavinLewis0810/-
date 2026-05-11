import { Link, useLocation } from 'react-router-dom';
import { Tooltip } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import styles from './Sidebar.module.css';

interface NavItem {
  path: string;
  label: string;
}

interface SidebarProps {
  currentUser?: any;
  onLogout?: () => void;
}

const navItems: NavItem[] = [
  // 管理员首页
  { path: '/dashboard', label: '数据大屏' },
  // 第1步：事前申请
  { path: '/applications', label: '事前申请' },
  // 第2步：借款申请
  { path: '/borrowings', label: '借款台账' },
  // 第3步：上传发票
  { path: '/upload', label: '上传发票' },
  // 第4步：发票列表 → 创建报销
  { path: '/invoices', label: '发票列表' },
  // 第5步：报销单台账
  { path: '/reimbursements', label: '报销单台账' },
  // 基础设置
  { path: '/bank-cards', label: '收款账户' },
  { path: '/profile', label: '个人信息' },
  // 管理员
  { path: '/users', label: '用户管理' },
  { path: '/projects', label: '项目预算' },
  { path: '/approval-rules', label: '审批规则' },
];

export default function Sidebar({ currentUser, onLogout }: SidebarProps) {
  const location = useLocation();

  // 🚀 管理员专属菜单列表
  const adminOnlyPaths = ['/dashboard', '/users', '/projects', '/approval-rules'];
  const employeeOnlyPaths = ['/bank-cards'];
  const filteredNavItems = navItems.filter(item => {
    if (adminOnlyPaths.includes(item.path) && currentUser?.role !== 'admin') return false;
    if (employeeOnlyPaths.includes(item.path) && currentUser?.role === 'admin') return false;
    return true;
  });

  return (
    <aside className={styles.sidebar}>
      {/* Top Section: Logo + Navigation */}
      <div className={styles.sidebarTop}>
        <div className={styles.logo}>
          <div className={styles.logoMark} />
          <span className={styles.logoText}>智能报销</span>
        </div>

        <nav className={styles.navigation}>
          {/* 🚀 渲染过滤后的菜单 */}
          {filteredNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              >
                <span className={styles.navDot} />
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            );
          })}

        </nav>
      </div>

      {/* Bottom Section: User Profile */}
      <div className={styles.sidebarBottom}>
        <div className={styles.userProfile} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div className={styles.userAvatar}>
            {/* 🚀 动态提取姓名的首字母 */}
            <span className={styles.userInitial}>
              {currentUser?.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U'}
            </span>
          </div>

          <div className={styles.userInfo} style={{ flex: 1, overflow: 'hidden' }}>
            {/* 🚀 动态显示姓名和角色 */}
            <span className={styles.userName}>{currentUser?.full_name || '未登录'}</span>
            <span className={styles.userRole}>
              {currentUser?.role === 'admin' ? '管理员' : '普通员工'}
            </span>
            {currentUser?.department && (
              <span className={styles.userRole} style={{ fontSize: 11, opacity: 0.7 }}>
                {currentUser.department}
              </span>
            )}
          </div>

          {/* 🚀 退出登录按钮 */}
          {onLogout && (
            <Tooltip title="退出系统">
              <button
                onClick={onLogout}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  color: 'var(--text-secondary)'
                }}
              >
                <LogoutOutlined style={{ fontSize: '16px' }} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}