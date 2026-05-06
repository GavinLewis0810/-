import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Descriptions, Input, Select, Button, message, Spin,
  Divider, Modal, Avatar, Space,
} from 'antd';
import {
  UserOutlined, EditOutlined, KeyOutlined, SaveOutlined,
  ClearOutlined, CheckOutlined,
} from '@ant-design/icons';
import { updateProfile, changePassword } from '../services/api';
import type { UserProfile } from '../types/invoice';

interface Props {
  currentUser: UserProfile;
  onUserUpdate: (u: UserProfile) => void;
}

export default function ProfilePage({ currentUser, onUserUpdate }: Props) {
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [department, setDepartment] = useState(currentUser.department || '');

  // Password modal
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

  // Canvas signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!currentUser.signature);
  const [sigPreview, setSigPreview] = useState(currentUser.signature || '');
  const [sigSaving, setSigSaving] = useState(false);

  // Sync when currentUser changes
  useEffect(() => {
    setFullName(currentUser.full_name);
    setDepartment(currentUser.department || '');
    setSigPreview(currentUser.signature || '');
    setHasSignature(!!currentUser.signature);
  }, [currentUser]);

  // Init canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // If existing signature, draw it
    if (sigPreview) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = sigPreview;
    }
  }, [sigPreview]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, [isDrawing]);

  const stopDraw = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);
  }, [isDrawing]);

  const handleClearSig = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSigPreview('');
  };

  const handleSaveSig = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    setSigSaving(true);
    try {
      const res = await updateProfile({ signature: dataUrl });
      onUserUpdate(res.user);
      setSigPreview(dataUrl);
      message.success('签名已保存');
    } catch (err: any) {
      console.error('签名保存失败:', err);
      message.error('签名保存失败: ' + (err?.response?.data?.detail || err?.message || '未知错误'));
    } finally {
      setSigSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const res = await updateProfile({
        full_name: fullName,
        department: department || null,
      });
      onUserUpdate(res.user);
      message.success('个人信息已更新');
      setEditMode(false);
    } catch {
      message.error('更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePwd = async () => {
    if (!oldPwd) { message.warning('请输入旧密码'); return; }
    if (!newPwd || newPwd.length < 3) { message.warning('新密码至少3位'); return; }
    setPwdLoading(true);
    try {
      await changePassword({ old_password: oldPwd, new_password: newPwd });
      message.success('密码修改成功，请重新登录');
      setPwdOpen(false);
      setOldPwd('');
      setNewPwd('');
      // Force re-login
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('currentUser');
      window.location.reload();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 24 }}>个人信息与电子签名</h2>

      <Row gutter={24}>
        {/* Left: Profile Info */}
        <Col xs={24} md={12}>
          <Card
            title="基本信息"
            extra={
              !editMode ? (
                <Button icon={<EditOutlined />} onClick={() => setEditMode(true)}>编辑</Button>
              ) : (
                <Space>
                  <Button onClick={() => setEditMode(false)}>取消</Button>
                  <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSaveProfile}>保存</Button>
                </Space>
              )
            }
          >
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <Avatar size={80} icon={<UserOutlined />}
                style={{ backgroundColor: 'var(--primary, #1677ff)', fontSize: 36 }}
              >
                {currentUser.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </Avatar>
              <h3 style={{ marginTop: 12, marginBottom: 0 }}>{currentUser.full_name}</h3>
              <span style={{ color: '#888' }}>
                {currentUser.role === 'admin' ? '管理员' : '普通员工'}
              </span>
            </div>

            <Descriptions column={1} bordered size="small" labelStyle={{ width: 100 }}>
              <Descriptions.Item label="用户名">{currentUser.username}</Descriptions.Item>
              <Descriptions.Item label="姓名">
                {editMode ? (
                  <Input value={fullName} onChange={e => setFullName(e.target.value)} />
                ) : currentUser.full_name}
              </Descriptions.Item>
              <Descriptions.Item label="部门">
                {editMode ? (
                  <Select value={department || undefined} onChange={v => setDepartment(v || '')} placeholder="选择部门" style={{ width: '100%' }} allowClear>
                    <Select.Option value="财务部">财务部</Select.Option>
                    <Select.Option value="研发部">研发部</Select.Option>
                    <Select.Option value="市场部">市场部</Select.Option>
                    <Select.Option value="销售部">销售部</Select.Option>
                    <Select.Option value="人力资源部">人力资源部</Select.Option>
                    <Select.Option value="行政部">行政部</Select.Option>
                    <Select.Option value="运维部">运维部</Select.Option>
                    <Select.Option value="采购部">采购部</Select.Option>
                    <Select.Option value="法务部">法务部</Select.Option>
                    <Select.Option value="管理层">管理层</Select.Option>
                  </Select>
                ) : (currentUser.department || <span style={{ color: '#ccc' }}>未设置</span>)}
              </Descriptions.Item>
              <Descriptions.Item label="角色">
                {currentUser.role === 'admin' ? '管理员' : '普通员工'}
              </Descriptions.Item>
            </Descriptions>

            <Divider />
            <Button icon={<KeyOutlined />} onClick={() => setPwdOpen(true)} block>
              修改密码
            </Button>
          </Card>
        </Col>

        {/* Right: Signature */}
        <Col xs={24} md={12}>
          <Card title="电子签名" extra={
            <Space>
              <Button icon={<ClearOutlined />} onClick={handleClearSig} disabled={!hasSignature}>清除</Button>
              <Button type="primary" icon={<CheckOutlined />} loading={sigSaving} onClick={handleSaveSig}>保存签名</Button>
            </Space>
          }>
            <div style={{ textAlign: 'center', marginBottom: 12, color: '#888', fontSize: 13 }}>
              使用鼠标在下方区域绘制您的电子签名
            </div>
            <canvas
              ref={canvasRef}
              width={400}
              height={160}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
              style={{
                border: '2px dashed #d9d9d9',
                borderRadius: 8,
                cursor: 'crosshair',
                width: '100%',
                height: 160,
                touchAction: 'none',
                background: '#fafafa',
              }}
            />
            {sigPreview && !isDrawing && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <span style={{ color: '#888', fontSize: 12 }}>当前签名预览</span>
                <br />
                <img src={sigPreview} alt="签名" style={{ maxWidth: '100%', maxHeight: 60, marginTop: 4 }} />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Change Password Modal */}
      <Modal
        title="修改密码"
        open={pwdOpen}
        onCancel={() => { setPwdOpen(false); setOldPwd(''); setNewPwd(''); }}
        onOk={handleChangePwd}
        confirmLoading={pwdLoading}
        okText="确认修改"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <Input.Password
            placeholder="旧密码"
            value={oldPwd}
            onChange={e => setOldPwd(e.target.value)}
          />
          <Input.Password
            placeholder="新密码（至少3位）"
            value={newPwd}
            onChange={e => setNewPwd(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
