import { useState, useEffect, useRef } from 'react';
import { Table, Button, Space, message, Modal, Input, InputNumber, Tag, Popconfirm, Progress, Select, DatePicker } from 'antd';
import { PlusOutlined, CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, DeleteOutlined, DollarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getApplications, createApplication, approveApplication, rejectApplication, deleteApplication, getProjects, createBorrowing, ApplicationItem } from '../services/api';

export default function ApplicationPage() {
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [projectCode, setProjectCode] = useState<string | undefined>(undefined);
  const [projectList, setProjectList] = useState<{ code: string; name: string; remaining: number }[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // 拨款弹窗（管理员专用）
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [disburseAppId, setDisburseAppId] = useState<number | null>(null);
  const [disburseTitle, setDisburseTitle] = useState('');
  const [disburseAmount, setDisburseAmount] = useState<number | null>(null);
  const [disburseDate, setDisburseDate] = useState<string | null>(null);
  const [disburseSubmitting, setDisburseSubmitting] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const s = localStorage.getItem('currentUser');
    if (s) setCurrentUser(JSON.parse(s));
    getProjects().then(ps => setProjectList(ps.map(p => ({
      code: p.project_code, name: p.project_name, remaining: Number(p.remaining),
    })))).catch(() => {});
  }, []);

  const fetch = async (silent = false) => {
    if (!silent) setLoading(true);
    try { setApps(await getApplications()); } catch { if (!silent) message.error('获取失败'); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => {
    fetch();
    pollingRef.current = setInterval(() => fetch(true), 10000);
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const handleCreate = async () => {
    if (!title.trim()) { message.warning('请输入申请事由'); return; }
    try {
      await createApplication({ title, description: desc, estimated_amount: amount, project_code: projectCode || undefined });
      message.success('申请已提交');
      setModalOpen(false); setTitle(''); setDesc(''); setAmount(0); setProjectCode(undefined);
      fetch();
    } catch (e: any) { message.error(e.response?.data?.detail || '提交失败'); }
  };

  const openDisburseModal = (app: ApplicationItem) => {
    const remaining = Math.max(0, app.estimated_amount - (app.used_amount || 0));
    setDisburseAppId(app.id);
    setDisburseTitle(`先行拨款-${app.title}`);
    setDisburseAmount(remaining > 0 ? remaining : 0);
    setDisburseDate(null);
    setDisburseOpen(true);
  };

  const handleDisburseSubmit = async () => {
    if (!disburseTitle.trim()) { message.warning('请输入拨款事由'); return; }
    if (!disburseAmount || disburseAmount <= 0) { message.warning('请输入有效的拨款金额'); return; }
    if (!disburseAppId) return;
    setDisburseSubmitting(true);
    try {
      await createBorrowing({
        title: disburseTitle.trim(),
        estimated_amount: disburseAmount,
        expected_repayment_date: disburseDate || undefined,
        application_id: disburseAppId,
      });
      message.success('拨款已到账');
      setDisburseOpen(false);
      fetch();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '拨款失败');
    } finally { setDisburseSubmitting(false); }
  };

  const columns: ColumnsType<ApplicationItem> = [
    { title: '编号', dataIndex: 'id', key: 'id', width: 70 },
    { title: '申请事由', dataIndex: 'title', key: 'title', width: 160, ellipsis: true },
    ...(isAdmin ? [{ title: '申请人', dataIndex: 'user_name', key: 'user_name', width: 80 }] : []),
    { title: '关联项目', dataIndex: 'project_name', key: 'project_name', width: 110,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#ccc' }}>-</span> },
    { title: '预估金额', dataIndex: 'estimated_amount', key: 'estimated_amount', width: 180, align: 'right' as const,
      render: (v: number, r: ApplicationItem) => {
        const used = r.used_amount || 0;
        if (r.status === '已通过' && v > 0) {
          const pct = Math.round((used / v) * 100);
          const overBudget = used > v;
          return (
            <div>
              <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                ¥{used.toFixed(0)} / ¥{v.toFixed(0)}
                {overBudget && (
                  <Tag color="error" style={{ marginLeft: 2, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    超{((used - v) / v * 100).toFixed(0)}%
                  </Tag>
                )}
              </div>
              <Progress percent={Math.min(pct, 100)} size="small" status={overBudget ? 'exception' : 'active'}
                style={{ margin: 0 }} />
            </div>
          );
        }
        return `¥${Number(v).toFixed(2)}`;
      } },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => <Tag color={s === '已通过' ? 'success' : s === '已驳回' ? 'error' : 'warning'}>{s}</Tag> },
    ...(isAdmin ? [{ title: '驳回理由', dataIndex: 'reject_reason', key: 'reject_reason', ellipsis: true, render: (v:string) => v || '-' }] : []),
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '操作', key: 'action', width: isAdmin ? 240 : 110,
      render: (_, r) => (
        <Space size="small">
          {isAdmin && r.status === '待审批' && (
            <>
              <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#22C55E' }}
                onClick={async () => { try { await approveApplication(r.id); message.success('已通过'); fetch(); } catch { message.error('失败'); } }}>
                通过</Button>
              <Popconfirm title="驳回原因" description={
                <Input id={`reject-reason-${r.id}`} placeholder="填写驳回原因" />
              } onConfirm={async () => {
                const reason = (document.getElementById(`reject-reason-${r.id}`) as HTMLInputElement)?.value || '';
                try { await rejectApplication(r.id, reason); message.success('已驳回'); fetch(); } catch { message.error('失败'); }
              }} okText="驳回" cancelText="取消">
                <Button type="link" size="small" danger icon={<CloseCircleOutlined />}>驳回</Button>
              </Popconfirm>
            </>
          )}
          {isAdmin && r.status === '已通过' && (() => {
            const rem = Math.max(0, r.estimated_amount - (r.used_amount || 0));
            return (
              <Button type="link" size="small" icon={<DollarOutlined />}
                style={{ color: rem <= 0 ? '#ccc' : '#22C55E' }}
                disabled={rem <= 0}
                title={rem <= 0 ? '申请额度已用尽' : `剩余可拨款 ¥${rem.toFixed(2)}`}
                onClick={() => openDisburseModal(r)}>
                拨款
              </Button>
            );
          })()}
          <Popconfirm title="确定删除？" onConfirm={async () => {
            try { await deleteApplication(r.id); message.success('已删除'); fetch(); } catch (e: any) { message.error(e.response?.data?.detail || '删除失败'); }
          }} okText="确定" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
          {!isAdmin && r.status === '已驳回' && r.reject_reason && (
            <span style={{ color: '#E42313', fontSize: 12 }}>{r.reject_reason}</span>
          )}
        </Space>
      ) },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>事前申请单</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>
            {isAdmin ? '审批员工的出差/业务申请' : '出差/业务申请，通过后方可报销'}
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => fetch()}>刷新</Button>
          {!isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建申请</Button>
          )}
        </Space>
      </div>

      <Table rowKey="id" columns={columns} dataSource={apps} loading={loading} pagination={false} />

      <Modal title="新建事前申请" open={modalOpen} onOk={handleCreate} onCancel={() => setModalOpen(false)} okText="提交" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="申请事由（如：出差 - 北京客户拜访）" />
          <Select
            value={projectCode}
            onChange={(v) => setProjectCode(v)}
            placeholder="关联项目（选填）"
            allowClear
            options={projectList.map(p => ({
              value: p.code,
              label: `${p.code} — ${p.name}（剩余 ¥${p.remaining.toFixed(0)}）`,
            }))}
          />
          <Input.TextArea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="详细说明（选填）" rows={2} />
          <InputNumber value={amount} onChange={(v) => setAmount(v || 0)} placeholder="预估金额" style={{ width: '100%' }} min={0} precision={2} prefix="¥" />
        </div>
      </Modal>

      {/* 先行拨款弹窗（管理员专用） */}
      <Modal title="先行拨款" open={disburseOpen} onOk={handleDisburseSubmit} onCancel={() => setDisburseOpen(false)}
        confirmLoading={disburseSubmitting} okText="确认拨款" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16, marginBottom: 8 }}>
          {(() => {
            const targetApp = apps.find(a => a.id === disburseAppId);
            const applicantName = targetApp?.user_name || '未知';
            const rem = targetApp ? Math.max(0, targetApp.estimated_amount - (targetApp.used_amount || 0)) : 0;
            return (
              <>
                <div style={{ padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, fontSize: 13, color: '#1677ff' }}>
                  对「{targetApp?.title}」（申请人：{applicantName}）进行先行拨款，拨款将自动批准并通知申请人
                </div>
                {rem <= 0 && (
                  <div style={{ padding: '8px 12px', background: '#fff2f0', borderRadius: 6, color: '#E42313', fontSize: 13 }}>
                    该事前申请的额度已用尽，无法继续拨款
                  </div>
                )}
                {rem > 0 && rem < (targetApp?.estimated_amount || 0) && (
                  <div style={{ padding: '8px 12px', background: '#fffbe6', borderRadius: 6, color: '#D48806', fontSize: 13 }}>
                    剩余可拨款额度 ¥{rem.toFixed(2)}
                  </div>
                )}
                <div>
                  <div style={{ marginBottom: 4, fontWeight: 500 }}>拨款事由</div>
                  <Input value={disburseTitle} onChange={e => setDisburseTitle(e.target.value)} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontWeight: 500 }}>拨款金额（剩余额度 ¥{rem.toFixed(2)}）</div>
                  <InputNumber style={{ width: '100%' }} value={disburseAmount} onChange={v => setDisburseAmount(v)} min={0} max={rem > 0 ? rem : undefined} precision={2} prefix="¥" />
                </div>
              </>
            );
          })()}
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>预计还款/冲销日期</div>
            <DatePicker style={{ width: '100%' }} onChange={v => setDisburseDate(v ? v.format('YYYY-MM-DD') : null)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
