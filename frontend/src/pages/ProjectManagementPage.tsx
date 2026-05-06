import { useState, useEffect } from 'react';
import { Table, Button, Space, message, Modal, Input, InputNumber, Popconfirm, Progress, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getProjects, createProject, updateProject, deleteProject, ProjectItem } from '../services/api';

export default function ProjectManagementPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formBudget, setFormBudget] = useState<number>(0);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data = await getProjects();
      setProjects(data);
    } catch { message.error('获取项目列表失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchProjects(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setFormCode('');
    setFormName('');
    setFormBudget(0);
    setModalOpen(true);
  };

  const openEdit = (p: ProjectItem) => {
    setEditingId(p.id);
    setFormCode(p.project_code);
    setFormName(p.project_name);
    setFormBudget(Number(p.budget));
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formCode.trim() || !formName.trim()) { message.warning('项目编号和名称不能为空'); return; }
    if (formBudget <= 0) { message.warning('预算必须大于 0'); return; }
    try {
      if (editingId) {
        await updateProject(editingId, { project_name: formName, budget: formBudget });
        message.success('项目已更新');
      } else {
        await createProject({ project_code: formCode, project_name: formName, budget: formBudget });
        message.success('项目已创建');
      }
      setModalOpen(false);
      fetchProjects();
    } catch (e: any) { message.error(e.response?.data?.detail || '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteProject(id); message.success('已删除'); fetchProjects(); }
    catch { message.error('删除失败'); }
  };

  const columns: ColumnsType<ProjectItem> = [
    { title: '项目编号', dataIndex: 'project_code', key: 'project_code' },
    { title: '项目名称', dataIndex: 'project_name', key: 'project_name' },
    { title: '预算', dataIndex: 'budget', key: 'budget', align: 'right', render: (v) => `¥${Number(v).toFixed(2)}` },
    { title: '已使用', dataIndex: 'used_amount', key: 'used_amount', align: 'right', render: (v) => `¥${Number(v).toFixed(2)}` },
    { title: '剩余', dataIndex: 'remaining', key: 'remaining', align: 'right',
      render: (v: any) => <span style={{ color: Number(v) < 0 ? '#E42313' : '#22C55E', fontWeight: 600 }}>¥{Number(v).toFixed(2)}</span> },
    { title: '使用率', dataIndex: 'usage_rate', key: 'usage_rate', width: 180,
      render: (rate: any) => (
        <Progress percent={Number(rate)} size="small" strokeColor={Number(rate) >= 100 ? '#E42313' : Number(rate) >= 80 ? '#faad14' : '#22C55E'} />
      ) },
    { title: '状态', key: 'status', width: 100,
      render: (_, r) => Number(r.usage_rate) >= 100 ? <Tag color="error">超预算</Tag> : Number(r.usage_rate) >= 80 ? <Tag color="warning">预警</Tag> : <Tag color="success">正常</Tag> },
    { title: '操作', key: 'action',
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>项目预算管理</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>管理各项目的预算额度，系统自动追踪使用情况并在超预算时预警</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchProjects}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建项目</Button>
        </Space>
      </div>

      <Table rowKey="id" columns={columns} dataSource={projects} loading={loading} pagination={false} />

      <Modal
        title={editingId ? '编辑项目' : '新建项目'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>项目编号</div>
            <Input value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="如: NSFC-2026-001" disabled={!!editingId} />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>项目名称</div>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="如: 国家自然科学基金项目" />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>预算金额</div>
            <InputNumber value={formBudget} onChange={(v) => setFormBudget(v || 0)} placeholder="如: 50000" style={{ width: '100%' }} min={0} precision={2} prefix="¥" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
