import { useState, useEffect } from 'react';
import { Table, Button, Space, message, Modal, Input, Tag, Popconfirm, Card, Statistic, Row, Col, Tabs, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined, StarOutlined, StarFilled, WalletOutlined, RiseOutlined, FallOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getBankCards, addBankCard, setDefaultBankCard, deleteBankCard, getTransactions, BankCardItem, TransactionItem } from '../services/api';

export default function BankCardPage() {
  const [cards, setCards] = useState<BankCardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const fetchCards = async () => {
    setLoading(true);
    try { setCards(await getBankCards()); } catch { message.error('获取失败'); }
    finally { setLoading(false); }
  };

  const fetchTransactions = async () => {
    setTxLoading(true);
    try { setTransactions(await getTransactions()); } catch { /* ignore */ }
    finally { setTxLoading(false); }
  };

  useEffect(() => { fetchCards(); fetchTransactions(); }, []);

  const totalBalance = cards.reduce((sum, c) => sum + (c.balance || 0), 0);

  const handleAdd = async () => {
    if (!bankName.trim() || !accountName.trim() || !cardNumber.trim()) {
      message.warning('所有字段均为必填'); return;
    }
    try {
      await addBankCard({ bank_name: bankName, account_name: accountName, card_number: cardNumber });
      message.success('已添加');
      setModalOpen(false);
      setBankName(''); setAccountName(''); setCardNumber('');
      fetchCards();
    } catch (e: any) { message.error(e.response?.data?.detail || '添加失败'); }
  };

  const handleSetDefault = async (id: number) => {
    try { await setDefaultBankCard(id); fetchCards(); } catch { message.error('操作失败'); }
  };

  const txColorMap: Record<string, string> = {
    '拨款': 'green',
    '报销到账': 'blue',
    '借款冲销': 'orange',
  };

  const txIconMap: Record<string, React.ReactNode> = {
    '拨款': <RiseOutlined style={{ color: '#22C55E' }} />,
    '报销到账': <RiseOutlined style={{ color: '#1677ff' }} />,
    '借款冲销': <FallOutlined style={{ color: '#D48806' }} />,
  };

  const cardColumns: ColumnsType<BankCardItem> = [
    { title: '开户行', dataIndex: 'bank_name', key: 'bank_name' },
    { title: '持卡人', dataIndex: 'account_name', key: 'account_name' },
    { title: '卡号', dataIndex: 'card_number', key: 'card_number',
      render: (v: string) => `****${v.slice(-4)}` },
    { title: '余额', dataIndex: 'balance', key: 'balance', align: 'right',
      render: (v: number) => <span style={{ fontWeight: 600, fontSize: 15, color: v > 0 ? '#22C55E' : '#666' }}>¥{v.toFixed(2)}</span> },
    { title: '默认', dataIndex: 'is_default', key: 'is_default', width: 80, align: 'center',
      render: (v: boolean) => v ? <Tag color="gold"><StarFilled /> 默认</Tag> : '-' },
    { title: '操作', key: 'action', width: 150,
      render: (_, r) => (
        <Space size="small">
          {!r.is_default && (
            <Button type="link" size="small" icon={<StarOutlined />} onClick={() => handleSetDefault(r.id)}>设为默认</Button>
          )}
          <Popconfirm title="确定删除？" onConfirm={async () => {
            try { await deleteBankCard(r.id); fetchCards(); } catch { message.error('删除失败'); }
          }} okText="确定" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ];

  const txColumns: ColumnsType<TransactionItem> = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '类型', dataIndex: 'type', key: 'type', width: 100,
      render: (v: string) => <Tag color={txColorMap[v] || 'default'}>{txIconMap[v]} {v}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', align: 'right', width: 120,
      render: (v: number) => (
        <span style={{ fontWeight: 500, color: v >= 0 ? '#22C55E' : '#E42313' }}>
          {v >= 0 ? '+' : ''}¥{v.toFixed(2)}
        </span>
      ) },
    { title: '变动前', dataIndex: 'balance_before', key: 'balance_before', align: 'right', width: 120,
      render: (v: number) => `¥${v.toFixed(2)}` },
    { title: '变动后', dataIndex: 'balance_after', key: 'balance_after', align: 'right', width: 120,
      render: (v: number) => <span style={{ fontWeight: 600 }}>¥{v.toFixed(2)}</span> },
    { title: '摘要', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>收款账户</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>管理收款银行卡，查看余额和资金流水</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>添加银行卡</Button>
      </div>

      {/* 余额概览 */}
      {cards.length > 0 && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic title="账户余额" value={totalBalance} precision={2} prefix={<WalletOutlined />} suffix="元"
                valueStyle={{ color: totalBalance > 0 ? '#22C55E' : '#666' }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="银行卡数" value={cards.length} prefix={<StarOutlined />} suffix="张" />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="交易笔数" value={transactions.length} suffix="笔" />
            </Card>
          </Col>
        </Row>
      )}

      <Tabs defaultActiveKey="cards" items={[
        {
          key: 'cards',
          label: '我的银行卡',
          children: (
            <Table rowKey="id" columns={cardColumns} dataSource={cards} loading={loading} pagination={false} />
          ),
        },
        {
          key: 'transactions',
          label: `资金流水 (${transactions.length})`,
          children: transactions.length === 0 ? (
            <Empty description="暂无交易流水，拨款或报销到账后将在此显示" />
          ) : (
            <Table rowKey="id" columns={txColumns} dataSource={transactions} loading={txLoading}
              pagination={{ pageSize: 15 }} size="small" />
          ),
        },
      ]} />

      <Modal title="添加银行卡" open={modalOpen} onOk={handleAdd} onCancel={() => setModalOpen(false)} okText="添加" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="开户行（如：中国工商银行）" />
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="持卡人姓名" />
          <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="银行卡号" maxLength={19} />
        </div>
      </Modal>
    </div>
  );
}
