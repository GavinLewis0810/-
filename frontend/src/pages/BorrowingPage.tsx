import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message, Modal, Input, Popconfirm } from 'antd';
import { ReloadOutlined, CheckOutlined, CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  getBorrowings, approveBorrowing, rejectBorrowing, deleteBorrowing,
  BorrowingItem,
} from '../services/api';

const statusColorMap: Record<string, string> = {
  '待审批': 'orange',
  '已批准': 'green',
  '已驳回': 'red',
  '已冲销': 'blue',
};

export default function BorrowingPage() {
  const [borrowings, setBorrowings] = useState<BorrowingItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 驳回弹窗
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const isAdmin = currentUser?.role === 'admin';

  const fetchList = async () => {
    setLoading(true);
    try {
      const data = await getBorrowings();
      setBorrowings(data);
    } catch { message.error('获取借款列表失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, []);

  const handleApprove = async (id: number) => {
    try { await approveBorrowing(id); message.success('已批准'); fetchList(); }
    catch { message.error('操作失败'); }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try { await rejectBorrowing(rejectId, rejectReason); message.success('已驳回'); setRejectId(null); setRejectReason(''); fetchList(); }
    catch { message.error('操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteBorrowing(id); message.success('已删除'); fetchList(); }
    catch { message.error('删除失败'); }
  };

  const columns: ColumnsType<BorrowingItem> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '借款事由', dataIndex: 'title', key: 'title' },
    {
      title: '借款金额', dataIndex: 'estimated_amount', key: 'estimated_amount',
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '预计还款日', dataIndex: 'expected_repayment_date', key: 'expected_repayment_date',
      render: (v: string | null) => v || '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => <Tag color={statusColorMap[s] || 'default'}>{s}</Tag>,
    },
    {
      title: '已冲销金额', dataIndex: 'repaid_amount', key: 'repaid_amount',
      render: (v: number | null) => v !== null ? `¥${v.toFixed(2)}` : '-',
    },
    { title: '申请人', dataIndex: 'user_name', key: 'user_name' },
    {
      title: '关联申请', dataIndex: 'application_title', key: 'application_title',
      render: (v: string | null) => v ? <Tag color="blue">{v}</Tag> : '-',
    },
    { title: '审批人', dataIndex: 'approver_name', key: 'approver_name', render: (v: string | null) => v || '-' },
    {
      title: '申请时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          {isAdmin && r.status === '待审批' && (
            <Popconfirm title="确认批准该借款申请？" onConfirm={() => handleApprove(r.id)} okText="批准" cancelText="取消">
              <Button size="small" type="primary" icon={<CheckOutlined />}>批准</Button>
            </Popconfirm>
          )}
          {isAdmin && r.status === '待审批' && (
            <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectId(r.id)}>驳回</Button>
          )}
          {isAdmin && (r.status === '已驳回' || r.status === '已批准' || r.status === '已冲销') && (
            <Popconfirm title={r.status === '已批准' ? '删除将撤回拨款，余额回退，确定删除？' : '确认删除？'}
              onConfirm={() => handleDelete(r.id)}>
              <Button size="small" icon={<DeleteOutlined />} danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>借款台账</h2>
          <p style={{ color: '#999', margin: '4px 0 0', fontSize: 13 }}>
            拨款由财务管理员在「事前申请」审批通过后操作，此处仅供查阅
          </p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchList}>刷新</Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={borrowings}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

      {/* 驳回弹窗 */}
      <Modal
        title="驳回借款申请"
        open={rejectId !== null}
        onCancel={() => { setRejectId(null); setRejectReason(''); }}
        onOk={handleReject}
        okText="确认驳回"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>驳回理由</div>
          <Input.TextArea rows={3} placeholder="请输入驳回理由" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
