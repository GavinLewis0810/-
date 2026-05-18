import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Tooltip } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import styles from './Sidebar.module.css';

// ── 类型 ──
interface DrawerChild {
  path: string;
  label: string;
  adminOnly?: boolean;
  employeeOnly?: boolean;
}

interface DrawerGroup {
  key: string;
  label: string;
  path?: string;          // standalone 项专用
  standalone?: boolean;    // 独立项，不可折叠
  adminOnly?: boolean;
  children?: DrawerChild[];
}

interface SidebarProps {
  currentUser?: any;
  onLogout?: () => void;
}

// ── 抽屉式导航数据 ──
const drawerGroups: DrawerGroup[] = [
  {
    key: 'dashboard',
    label: '📺 数据大屏',
    standalone: true,
    path: '/dashboard',
    adminOnly: true,
  },
  {
    key: 'invoice',
    label: '📦 发票管理',
    children: [
      { path: '/upload', label: '上传发票' },
      { path: '/invoices', label: '发票列表' },
    ],
  },
  {
    key: 'reimbursement',
    label: '📦 报销中心',
    children: [
      { path: '/applications', label: '事前申请' },
      { path: '/borrowings', label: '借款台账' },
      { path: '/reimbursements', label: '报销单台账' },
    ],
  },
  {
    key: 'insight',
    label: '📦 数据与洞察',
    children: [
      { path: '/carbon-footprint', label: '🌿 碳足迹' },
      { path: '/ai-observatory', label: '🤖 AI 引擎监控', adminOnly: true },
      { path: '/evaluation', label: '📊 精度评估' },
    ],
  },
  {
    key: 'settings',
    label: '📦 基础设置',
    children: [
      { path: '/bank-cards', label: '收款账户', employeeOnly: true },
      { path: '/profile', label: '个人信息' },
      { path: '/users', label: '用户管理', adminOnly: true },
      { path: '/projects', label: '项目预算', adminOnly: true },
      { path: '/approval-rules', label: '审批规则', adminOnly: true },
      { path: '/audit-trail', label: '操作审计', adminOnly: true },
    ],
  },
];

// ── 判断子项对当前用户可见 ──
function isChildVisible(child: DrawerChild, isAdmin: boolean): boolean {
  if (child.adminOnly && !isAdmin) return false;
  if (child.employeeOnly && isAdmin) return false;
  return true;
}

// ── 判断组对当前用户可见 ──
function isGroupVisible(group: DrawerGroup, isAdmin: boolean): boolean {
  if (group.adminOnly && !isAdmin) return false;
  if (group.standalone) return true;
  // 如果组内至少有一个子项可见，则组可见
  return group.children?.some(c => isChildVisible(c, isAdmin)) ?? false;
}

// ── 获取路由所属的抽屉 key ──
function getGroupKeyByPath(pathname: string): string | null {
  for (const g of drawerGroups) {
    if (g.path === pathname) return g.key;
    if (g.children?.some(c => c.path === pathname)) return g.key;
  }
  return null;
}

export default function Sidebar({ currentUser, onLogout }: SidebarProps) {
  const location = useLocation();
  const isAdmin = currentUser?.role === 'admin';

  // 展开状态：key → boolean
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 路由变化时自动展开所属抽屉
  useEffect(() => {
    const groupKey = getGroupKeyByPath(location.pathname);
    if (groupKey) {
      setExpanded(prev => ({ ...prev, [groupKey]: true }));
    }
  }, [location.pathname]);

  const toggleGroup = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 可见的组列表
  const visibleGroups = drawerGroups.filter(g => isGroupVisible(g, isAdmin));

  return (
    <aside className={styles.sidebar}>
      {/* ====== Top: Logo + Navigation ====== */}
      <div className={styles.sidebarTop}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoMark}>
            <div className={styles.logoMarkInner} />
          </div>
          <span className={styles.logoText}>智能报销</span>
        </div>

        {/* Navigation */}
        <nav className={styles.navigation}>
          {visibleGroups.map(group => {
            const isActive = group.path === location.pathname;

            // ── standalone: 直接渲染为链接 ──
            if (group.standalone && group.path) {
              return (
                <Link
                  key={group.key}
                  to={group.path}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                >
                  <span className={styles.navDot} />
                  <span className={styles.navLabel}>{group.label}</span>
                </Link>
              );
            }

            // ── drawer group ──
            const isOpen = !!expanded[group.key];
            const visibleChildren = (group.children || []).filter(c => isChildVisible(c, isAdmin));
            if (visibleChildren.length === 0) return null;

            return (
              <div key={group.key} className={styles.drawerGroup}>
                {/* drawer header */}
                <div
                  className={styles.drawerHeader}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
                    ▸
                  </span>
                  <span className={styles.drawerLabel}>{group.label}</span>
                </div>

                {/* drawer children */}
                <div className={`${styles.drawerChildren} ${isOpen ? styles.drawerOpen : ''}`}>
                  {visibleChildren.map(child => {
                    const childActive = location.pathname === child.path;
                    return (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`${styles.navItem} ${styles.navChild} ${childActive ? styles.active : ''}`}
                      >
                        <span className={styles.navDot} />
                        <span className={styles.navLabel}>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      {/* ====== Bottom: User Profile ====== */}
      <div className={styles.sidebarBottom}>
        <div className={styles.userProfile}>
          <div className={styles.userAvatar}>
            <span className={styles.userInitial}>
              {currentUser?.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U'}
            </span>
          </div>

          <div className={styles.userInfo}>
            <span className={styles.userName}>{currentUser?.full_name || '未登录'}</span>
            <span className={styles.userRole}>
              {currentUser?.role === 'admin' ? '管理员' : '普通员工'}
            </span>
            {currentUser?.department && (
              <span className={styles.userDept}>{currentUser.department}</span>
            )}
          </div>

          {onLogout && (
            <Tooltip title="退出系统">
              <button className={styles.logoutBtn} onClick={onLogout}>
                <LogoutOutlined style={{ fontSize: 16 }} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
