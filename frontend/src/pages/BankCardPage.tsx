import { useState, useEffect } from 'react';
import { Table, Button, Space, message, Modal, Input, Tag, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getBankCards, addBankCard, setDefaultBankCard, deleteBankCard, BankCardItem } from '../services/api';

export default function BankCardPage() {
  const [cards, setCards] = useState<BankCardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [cardNumber, setCardNumber] = useState('');

  const fetchCards = async () => {
    setLoading(true);
    try { setCards(await getBankCards()); } catch { message.error('获取失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCards(); }, []);

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

  const columns: ColumnsType<BankCardItem> = [
    { title: '开户行', dataIndex: 'bank_name', key: 'bank_name' },
    { title: '持卡人', dataIndex: 'account_name', key: 'account_name' },
    { title: '卡号', dataIndex: 'card_number', key: 'card_number',
      render: (v: string) => `****${v.slice(-4)}` },
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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>收款银行卡</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>绑定收款账户，提交报销单时选择收款卡。仅记录打款所需信息，不显示账户余额</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>添加银行卡</Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={cards} loading={loading} pagination={false} />

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
