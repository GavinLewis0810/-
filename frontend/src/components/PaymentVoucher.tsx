import { Card, Descriptions, Tag, Typography, Divider } from 'antd';
import { CheckCircleOutlined, BankOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { Reimbursement } from '../types/invoice';

interface Props {
  reimb: Reimbursement;
  payment?: {
    transaction_id: string;
    batch_no: string;
    amount: number;
    from_bank: string;
    from_account: string;
    to_bank: string;
    to_account: string;
    payee_name: string;
    transfer_time: string;
    estimated_arrival: string;
    message: string;
  } | null;
}

export default function PaymentVoucher({ reimb, payment }: Props) {
    const txId = payment?.transaction_id || reimb.payment_transaction_id;
  const payBank = payment?.to_bank || reimb.payment_bank;
  const toAccount = payment?.to_account || (reimb.payment_bank ? '****' + '****' : '****');
  const payTime = payment?.transfer_time_str || payment?.transfer_time || reimb.payment_time;
  const arrivalTime = payment?.estimated_arrival || '';
  const payee = payment?.payee_name || reimb.submitter || '';
  const batchNo = payment?.batch_no || '';
  const maskedAccount = toAccount.length > 4 ? `尾号${toAccount.slice(-4)}` : toAccount;

  if (!txId) return null;

  return (
    <Card
      title={
        <span>
          <SafetyCertificateOutlined style={{ color: '#1677ff', marginRight: 8 }} />
          银行电子回单
        </span>
      }
      style={{
        borderTop: '3px solid #1677ff',
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
      size="small"
    >
      {/* 转账成功横幅 */}
      <div style={{
        textAlign: 'center',
        padding: '16px 0',
        background: 'linear-gradient(135deg, #f6ffed 0%, #e6f7ff 100%)',
        borderRadius: 8,
        marginBottom: 16,
      }}>
        <CheckCircleOutlined style={{ color: '#22C55E', fontSize: 36, marginBottom: 8 }} />
        <Typography.Title level={4} style={{ margin: 0, color: '#22C55E' }}>
          转账成功
        </Typography.Title>
        <Typography.Text style={{ fontSize: 14, color: '#333', marginTop: 8, display: 'block' }}>
          向 <strong>{payee}</strong> 的 <strong>{payBank}{maskedAccount}</strong>
        </Typography.Text>
        <Typography.Text style={{ fontSize: 20, fontWeight: 700, color: '#E42313', display: 'block', marginTop: 4 }}>
          ¥{Number(reimb.total_amount).toFixed(2)}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          流水号 {txId}
        </Typography.Text>
      </div>

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="交易流水号">
          <Tag color="blue">{txId}</Tag>
        </Descriptions.Item>
        {batchNo && <Descriptions.Item label="银企批次号">{batchNo}</Descriptions.Item>}
        <Descriptions.Item label="付款账户">
          {payment?.from_bank || '中国工商银行北京分行'} / {payment?.from_account || '6222****1234'}
        </Descriptions.Item>
        <Descriptions.Item label="收款银行">{payBank || '-'}</Descriptions.Item>
        <Descriptions.Item label="收款账号">{toAccount}</Descriptions.Item>
        <Descriptions.Item label="收款人">{payee || '-'}</Descriptions.Item>
        <Descriptions.Item label="打款时间">
          {payTime ? new Date(payTime).toLocaleString() : '-'}
        </Descriptions.Item>
        {arrivalTime && (
          <Descriptions.Item label="预计到账">
            {new Date(arrivalTime).toLocaleString()}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="交易状态">
          <Tag color="success">SUCCESS</Tag>
        </Descriptions.Item>
      </Descriptions>

      <Divider style={{ margin: '12px 0' }} />
      <div style={{
        padding: '8px 12px',
        background: '#fafafa',
        borderRadius: 6,
        fontSize: 11,
        color: '#999',
        textAlign: 'center',
      }}>
        <BankOutlined /> 本回单由智能报销财务系统模拟银企直联生成 · 仅供内部核算闭环使用
      </div>
    </Card>
  );
}
