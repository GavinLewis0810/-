import { useState } from 'react';
import { Input, Button, message, Tabs, Alert, Typography } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  IdcardOutlined,
  CrownOutlined,
  TeamOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import api from '../services/api';

const { Text } = Typography;

interface AuthPageProps {
  onLoginSuccess: (user: any) => void;
}

// v0 shadcn/ui default palette
const primary = '#1E293B';       // slate-800  → 对应 shadcn --primary
const primaryDark = '#0F172A';   // slate-900
const primaryDeeper = '#020617'; // slate-950
const adminAccent = '#E42313';   // red for admin channel

const textMuted = '#64748B';     // slate-500
const border = '#E2E8F0';       // slate-200
const bg = '#F8FAFC';           // slate-50

export default function AuthPage({ onLoginSuccess }: AuthPageProps) {
  const [portalType, setPortalType] = useState<'employee' | 'admin'>('employee');
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', full_name: '', password: '' });

  // ---------- login ----------
  const handleLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
      message.error('请填写完整的登录信息');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/login', loginForm);
      const { user, token } = res.data;

      if (portalType === 'admin' && user.role !== 'admin') {
        message.error('权限拒绝：该账号非管理员，请前往员工通道登录！');
        return;
      }
      if (portalType === 'employee' && user.role === 'admin') {
        message.warning('您是管理员，已自动为您切换至管理后台');
      }

      localStorage.setItem('sessionToken', token);
      localStorage.setItem('currentUser', JSON.stringify(user));
      message.success(`欢迎回来，${user.full_name}`);
      onLoginSuccess(user);
    } catch (error: any) {
      message.error(error.response?.data?.detail || '登录失败，请检查用户名或密码');
    } finally {
      setLoading(false);
    }
  };

  // ---------- register ----------
  const handleRegister = async () => {
    if (!registerForm.username || !registerForm.full_name || !registerForm.password) {
      message.error('请填写完整的注册信息');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/register', registerForm);
      message.success('注册成功！请登录');
      setActiveTab('login');
      setRegisterForm({ username: '', full_name: '', password: '' });
    } catch (error: any) {
      message.error(error.response?.data?.detail || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: <FileTextOutlined style={{ fontSize: 20, color: '#fff' }} />, title: 'AI智能识票', desc: '一键上传，自动识别发票信息' },
    { icon: <CheckCircleOutlined style={{ fontSize: 20, color: '#fff' }} />, title: '合规自动校验', desc: '实时检测，确保每笔报销合规' },
    { icon: <BarChartOutlined style={{ fontSize: 20, color: '#fff' }} />, title: '数据洞察分析', desc: '多维报表，助力财务决策' },
  ];

  // ===================== shared helpers =====================

  const iconInput = (icon: React.ReactNode, placeholder: string, value: string, onChange: (v: string) => void, isPassword = false) => {
    const shared = {
      prefix: <span style={{ color: textMuted }}>{icon}</span>,
      placeholder,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      style: { height: 48, borderRadius: 12, fontSize: 14 },
    };
    return isPassword ? <Input.Password {...shared} visibilityToggle /> : <Input {...shared} />;
  };

  const portalBtn = (
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    label: string,
    accent: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '11px 16px', borderRadius: 12,
        border: active ? `2px solid ${accent}` : `2px solid ${border}`,
        background: active ? `${accent}08` : '#FFFFFF',
        color: active ? accent : textMuted,
        fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
        flex: 1,
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  // ===================== RENDER =====================
  return (
    <>
      <style>{`
        .auth-left { display: flex; }
        .auth-mobile-header { display: none; }
        @media (max-width: 1023px) {
          .auth-left { display: none; }
          .auth-mobile-header { display: flex; }
        }
      `}</style>

      <div style={{ display: 'flex', minHeight: '100vh', background: bg }}>
        {/* ========== LEFT BRAND PANEL ========== */}
        <div
          className="auth-left"
          style={{
            width: '50%', position: 'relative', overflow: 'hidden',
            background: `linear-gradient(160deg, ${primary} 0%, ${primaryDark} 60%, ${primaryDeeper} 100%)`,
          }}
        >
          {/* bg pattern */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.07 }}>
            <div style={{
              width: '100%', height: '100%',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>

          {/* glow circles */}
          <div style={{ position: 'absolute', top: '-25%', left: '-25%', width: '55%', height: '55%', background: 'rgba(56,189,248,0.06)', borderRadius: '50%', filter: 'blur(100px)' }} />
          <div style={{ position: 'absolute', bottom: '-25%', right: '-20%', width: '60%', height: '60%', background: 'rgba(129,140,248,0.05)', borderRadius: '50%', filter: 'blur(100px)' }} />

          {/* content */}
          <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 56px', width: '100%', color: '#F8FAFC' }}>
            {/* top */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{
                  display: 'flex', width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 12, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}>
                  <CrownOutlined style={{ fontSize: 24, color: '#fff' }} />
                </div>
                <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>智能报销</span>
              </div>

              <h1 style={{ fontSize: 44, fontWeight: 800, color: '#F8FAFC', lineHeight: 1.2, marginBottom: 16 }}>
                AI驱动的<br />业财一体化平台
              </h1>
              <p style={{ fontSize: 16, color: 'rgba(248,250,252,0.55)', maxWidth: 440, lineHeight: 1.6, marginBottom: 0 }}>
                从发票识别到费用分析，全流程智能化管理，让报销更简单，让财务更高效
              </p>
            </div>

            {/* features */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {features.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
                    borderRadius: 12, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(6px)',
                    border: '1px solid rgba(255,255,255,0.08)', transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                >
                  <div style={{ display: 'flex', width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: 'rgba(255,255,255,0.12)' }}>
                    {f.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2, color: '#F1F5F9' }}>{f.title}</div>
                    <div style={{ fontSize: 13, color: 'rgba(241,245,249,0.55)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* stats */}
            <div style={{ display: 'flex', gap: 40, paddingTop: 32, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {[
                { num: '50,000+', label: '企业用户' },
                { num: '99.9%', label: '识别准确率' },
                { num: '3秒', label: '平均处理时间' },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{s.num}</div>
                  <div style={{ fontSize: 13, color: 'rgba(248,250,252,0.4)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ========== RIGHT FORM PANEL ========== */}
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', width: '50%' }}>
          {/* mobile header */}
          <div
            className="auth-mobile-header"
            style={{
              height: 130, alignItems: 'flex-end', padding: 24,
              background: `linear-gradient(160deg, ${primary} 0%, ${primaryDark} 90%)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff' }}>
              <div style={{ display: 'flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)' }}>
                <CrownOutlined style={{ fontSize: 20 }} />
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>智能报销</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>AI驱动的业财一体化平台</div>
              </div>
            </div>
          </div>

          {/* form area */}
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '32px 48px' }}>
            <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
              {/* desktop title */}
              <div className="auth-left" style={{ flexDirection: 'column', marginBottom: 32 }}>
                <h2 style={{ fontSize: 28, fontWeight: 700, color: primary, marginBottom: 6 }}>欢迎回来</h2>
                <p style={{ fontSize: 14, color: textMuted, marginBottom: 0 }}>请登录您的账户以继续</p>
              </div>

              {/* portal toggle */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32 }}>
                {portalBtn(
                  portalType === 'employee',
                  () => { setPortalType('employee'); setActiveTab('login'); },
                  <TeamOutlined style={{ fontSize: 18 }} />,
                  '员工通道',
                  primary,
                )}
                {portalBtn(
                  portalType === 'admin',
                  () => { setPortalType('admin'); setActiveTab('login'); },
                  <CrownOutlined style={{ fontSize: 18 }} />,
                  '管理后台',
                  adminAccent,
                )}
              </div>

              {/* ---- admin ---- */}
              {portalType === 'admin' && (
                <div>
                  <Alert
                    message="后台系统重地"
                    description="管理员账号由系统底层分配，不支持外部自行注册。"
                    type="warning"
                    showIcon
                    icon={<CrownOutlined />}
                    style={{ marginBottom: 24, borderRadius: 12, border: '1px solid #FDE68A', background: '#FFFBEB' }}
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>管理员账号</Text>
                      {iconInput(<UserOutlined />, '请输入管理员账号', loginForm.username, v => setLoginForm({ ...loginForm, username: v }))}
                    </div>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>安全密码</Text>
                      {iconInput(<LockOutlined />, '请输入密码', loginForm.password, v => setLoginForm({ ...loginForm, password: v }), true)}
                    </div>
                    <Button
                      block
                      size="large"
                      loading={loading}
                      onClick={handleLogin}
                      style={{
                        height: 48, borderRadius: 12, fontWeight: 600, fontSize: 15,
                        background: adminAccent, borderColor: adminAccent, color: '#fff',
                      }}
                    >
                      进入管理后台
                    </Button>
                  </div>
                </div>
              )}

              {/* ---- employee ---- */}
              {portalType === 'employee' && (
                <Tabs
                  activeKey={activeTab}
                  onChange={setActiveTab}
                  centered
                  size="large"
                  items={[
                    {
                      key: 'login',
                      label: '员工登录',
                      children: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>用户名</Text>
                            {iconInput(<UserOutlined />, '请输入用户名', loginForm.username, v => setLoginForm({ ...loginForm, username: v }))}
                          </div>
                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>密码</Text>
                            {iconInput(<LockOutlined />, '请输入密码', loginForm.password, v => setLoginForm({ ...loginForm, password: v }), true)}
                          </div>
                          <Button
                            type="primary"
                            block
                            size="large"
                            loading={loading}
                            onClick={handleLogin}
                            style={{ height: 48, borderRadius: 12, fontWeight: 600, fontSize: 15,
                              background: primary, borderColor: primary,
                            }}
                          >
                            登录系统
                          </Button>
                        </div>
                      ),
                    },
                    {
                      key: 'register',
                      label: '新员工注册',
                      children: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>登录用户名</Text>
                            {iconInput(<UserOutlined />, '设置您的登录用户名', registerForm.username, v => setRegisterForm({ ...registerForm, username: v }))}
                          </div>
                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>真实姓名</Text>
                            {iconInput(<IdcardOutlined />, '您的真实姓名（如：张三）', registerForm.full_name, v => setRegisterForm({ ...registerForm, full_name: v }))}
                          </div>
                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 14, color: primary }}>安全密码</Text>
                            {iconInput(<LockOutlined />, '设置您的安全密码', registerForm.password, v => setRegisterForm({ ...registerForm, password: v }), true)}
                          </div>
                          <Button
                            block
                            size="large"
                            loading={loading}
                            onClick={handleRegister}
                            style={{ height: 48, borderRadius: 12, fontWeight: 600, fontSize: 15,
                              background: '#fff', borderColor: border, color: primary,
                            }}
                          >
                            注册并提交
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}

              {/* footer */}
              <p style={{ marginTop: 32, textAlign: 'center', fontSize: 13, color: textMuted }}>
                登录即表示您同意我们的
                <a style={{ color: primary, margin: '0 4px', cursor: 'pointer', fontWeight: 500 }}>服务条款</a>
                和
                <a style={{ color: primary, margin: '0 4px', cursor: 'pointer', fontWeight: 500 }}>隐私政策</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
