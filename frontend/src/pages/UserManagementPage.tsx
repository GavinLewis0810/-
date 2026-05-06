import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message, Modal, Input, Popconfirm } from 'antd';
import { ReloadOutlined, StopOutlined, CheckCircleOutlined, LockOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getAdminUsers, toggleUserStatus, resetUserPassword, AdminUserItem } from '../services/api';

export default function UserManagementPage() {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await getAdminUsers();
      setUsers(data);
    } catch {
      message.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleToggleStatus = async (userId: number) => {
    try {
      const res = await toggleUserStatus(userId);
      message.success(res.message);
      fetchUsers();
    } catch {
      message.error('操作失败');
    }
  };

  const handleResetPassword = (userId: number, username: string) => {
    Modal.confirm({
      title: `重置密码 - ${username}`,
      content: (
        <Input.Password id="newPasswordInput" placeholder="请输入新密码（至少3位）" style={{ marginTop: 12 }} />
      ),
      okText: '确认重置',
      cancelText: '取消',
      onOk: async () => {
        const input = document.getElementById('newPasswordInput') as HTMLInputElement;
        const newPassword = input?.value?.trim();
        if (!newPassword || newPassword.length < 3) {
          message.warning('密码至少3位');
          return Promise.reject();
        }
        try {
          const res = await resetUserPassword(userId, newPassword);
          message.success(res.message);
        } catch {
          message.error('重置失败');
        }
      },
    });
  };

  const columns: ColumnsType<AdminUserItem> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'full_name', key: 'full_name' },
    { title: '部门', dataIndex: 'department', key: 'department', render: (v: string | null) => v || '-' },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>{role === 'admin' ? '管理员' : '员工'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? '正常' : '已禁用'}</Tag>
      ),
    },
    {
      title: '发票数',
      dataIndex: 'invoice_count',
      key: 'invoice_count',
      align: 'right',
    },
    {
      title: '报销单数',
      dataIndex: 'reimbursement_count',
      key: 'reimbursement_count',
      align: 'right',
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string | null) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          <Popconfirm
            title={record.is_active ? `确定禁用 ${record.username}？` : `确定启用 ${record.username}？`}
            onConfirm={() => handleToggleStatus(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger={record.is_active}
              icon={record.is_active ? <StopOutlined /> : <CheckCircleOutlined />}
              disabled={record.role === 'admin'}
            >
              {record.is_active ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
          <Button
            type="link"
            size="small"
            icon={<LockOutlined />}
            onClick={() => handleResetPassword(record.id, record.username)}
          >
            重置密码
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>用户管理</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>管理所有注册用户，支持启用/禁用与密码重置</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchUsers}>刷新</Button>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={false}
      />
    </div>
  );
}
