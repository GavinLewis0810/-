import { useState } from 'react';
import { Card, Tabs, Form, Input, Button, message, Radio, Alert } from 'antd';
import { UserOutlined, LockOutlined, IdcardOutlined, CrownOutlined, TeamOutlined } from '@ant-design/icons';
import api from '../services/api';

interface AuthPageProps {
  onLoginSuccess: (user: any) => void;
}

export default function AuthPage({ onLoginSuccess }: AuthPageProps) {
  // 🚀 核心状态：当前处于哪个通道？'employee' (员工) 或 'admin' (管理员)
  const [portalType, setPortalType] = useState('employee');
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: any) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', values);
      const { user, token } = res.data;

      // 🚀 核心拦截逻辑：跨通道登录拦截
      if (portalType === 'admin' && user.role !== 'admin') {
        message.error('权限拒绝：该账号非管理员，请前往员工通道登录！');
        return;
      }

      if (portalType === 'employee' && user.role === 'admin') {
         message.warning('您是管理员，已自动为您切换至管理后台');
      }

      // 同时保存 token（用于后端验证）和 user
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

  const handleRegister = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/auth/register', values);
      message.success('注册成功！请登录');
      setActiveTab('login');
    } catch (error: any) {
      message.error(error.response?.data?.detail || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 440, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {/* 配合你截图里的红色主题 */}
          <h2 style={{ color: '#E42313', margin: 0 }}>智能报销财务系统</h2>
          <p style={{ color: '#888', marginTop: 8 }}>AI驱动的业财一体化平台</p>
        </div>

        {/* 🚀 身份通道切换器 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <Radio.Group
            value={portalType}
            onChange={(e) => {
              setPortalType(e.target.value);
              setActiveTab('login'); // 切换通道时，统一重置到登录页面
            }}
            buttonStyle="solid"
            size="large"
          >
            <Radio.Button value="employee"><TeamOutlined /> 员工通道</Radio.Button>
            <Radio.Button value="admin"><CrownOutlined /> 管理后台</Radio.Button>
          </Radio.Group>
        </div>

        {portalType === 'admin' ? (
          /* 👑 管理员通道：只能登录，彻底封杀注册入口 */
          <div style={{ padding: '10px 0' }}>
            <Alert
              message="后台系统重地"
              description="管理员账号由系统底层分配，不支持外部自行注册。"
              type="warning"
              showIcon
              icon={<CrownOutlined />}
              style={{ marginBottom: 24 }}
            />
            <Form onFinish={handleLogin} layout="vertical">
              <Form.Item name="username" rules={[{ required: true, message: '请输入管理员账号' }]}>
                <Input prefix={<UserOutlined />} placeholder="管理员账号 (如: admin)" size="large" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="安全密码" size="large" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ background: '#D48806', borderColor: '#D48806' }}>
                进入管理后台
              </Button>
            </Form>
          </div>
        ) : (
          /* 👨‍💼 员工通道：标准的登录与注册双栏 */
          <Tabs activeKey={activeTab} onChange={setActiveTab} centered>
            <Tabs.TabPane tab="员工登录" key="login">
              <Form onFinish={handleLogin} layout="vertical" style={{ marginTop: 10 }}>
                <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                  登录系统
                </Button>
              </Form>
            </Tabs.TabPane>

            <Tabs.TabPane tab="新员工注册" key="register">
              <Form onFinish={handleRegister} layout="vertical" style={{ marginTop: 10 }}>
                <Form.Item name="username" rules={[{ required: true, message: '请输入期望的用户名' }]}>
                  <Input prefix={<UserOutlined />} placeholder="设置登录用户名" size="large" />
                </Form.Item>
                <Form.Item name="full_name" rules={[{ required: true, message: '请输入真实姓名' }]}>
                  <Input prefix={<IdcardOutlined />} placeholder="您的真实姓名 (如: 张三)" size="large" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="设置安全密码" size="large" />
                </Form.Item>
                <Button type="default" htmlType="submit" block size="large" loading={loading}>
                  注册并提交
                </Button>
              </Form>
            </Tabs.TabPane>
          </Tabs>
        )}
      </Card>
    </div>
  );
}