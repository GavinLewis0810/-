import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions, Table, Tag, Button, Space, message, Spin, Card,
  Input, Modal, Timeline, Empty, Alert, Popconfirm
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, RobotOutlined, SafetyCertificateOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getReimbursementDetail, getReimbursementTimeline,
  approveReimbursement, rejectReimbursement, aiCheckReimbursement,
  completeReimbursement,
} from '../services/api';
import PrintVoucher from '../components/PrintVoucher';
import PaymentVoucher from '../components/PaymentVoucher';
import type { Reimbursement, Invoice, InvoiceStatus } from '../types/invoice';
import { ReimbursementStatus } from '../types/invoice';

const statusColorMap: Record<string, string> = {
  done: '#22C55E', processing: '#1677ff', pending: '#d9d9d9', error: '#E42313',
};

export default function ReimbursementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [reimb, setReimb] = useState<Reimbursement | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [aiCheckResult, setAiCheckResult] = useState<any>(null);
  const [aiChecking, setAiChecking] = useState(false);
  const [paymentResult, setPaymentResult] = useState<any>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [approving, setApproving] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectModalVisible, setRejectModalVisible] = useState(false);

  // 当前用户（含电子签名）
  const [currentUser, setCurrentUser] = useState<any>(null);
  useEffect(() => {
    const s = localStorage.getItem('currentUser');
    if (s) setCurrentUser(JSON.parse(s));
  }, []);

  const submitterSignature = currentUser?.signature || null;

  const fetchDetail = async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const data = await getReimbursementDetail(parseInt(id));
      setReimb(data);
      if (data.ai_review_detail) setAiCheckResult(data.ai_review_detail);
      if (data.payment_transaction_id) {
        setPaymentResult({
          transaction_id: data.payment_transaction_id,
          to_bank: data.payment_bank,
          transfer_time: data.payment_time,
        });
      }
    } catch { if (!silent) message.error('获取报销单详情失败'); }
    finally { if (!silent) setLoading(false); }
  };

  const fetchTimeline = async () => {
    if (!id) return;
    try {
      const res = await getReimbursementTimeline(parseInt(id));
      setTimeline(res.timeline);
    } catch { setTimeline([]); }
  };

  useEffect(() => {
    fetchDetail(); fetchTimeline();
    pollingRef.current = setInterval(() => { fetchDetail(true); fetchTimeline(); }, 10000);
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [id]);

  const handleAiCheck = async () => {
    if (!id) return;
    setAiChecking(true);
    try {
      const res = await aiCheckReimbursement(parseInt(id));
      setAiCheckResult(res);
      message.success('AI 审查完成');
      fetchTimeline();
    } catch (e: any) { message.error('审查失败：' + (e.response?.data?.detail || e.message)); }
    finally { setAiChecking(false); }
  };

  const handleApprove = () => {
    if (!id) return;
    // 检查警告项
    const risks: string[] = [];
    if (aiCheckResult?.risk_level && (aiCheckResult.risk_level === '高' || aiCheckResult.risk_level === '中')) {
      risks.push(`AI 风险评级：${aiCheckResult.risk_level}风险 — ${aiCheckResult.reason || ''}`);
    }
    if (reimb?.ai_risk_level && String(reimb.ai_risk_level).includes('高')) {
      risks.push('该报销单 AI 审查判定为高风险');
    }

    Modal.confirm({
      title: risks.length > 0 ? '⚠️ 确认审批通过（含风险预警）' : '确认审批通过',
      content: risks.length > 0 ? (
        <div>
          <Alert type="error" showIcon style={{ marginBottom: 12 }}
            message="以下风险项请仔细确认：" description={risks.join('\n')} />
          <p>确定要继续通过该报销单吗？</p>
        </div>
      ) : '确定要通过该报销单吗？',
      okText: '确认通过',
      cancelText: '取消',
      okButtonProps: { style: { background: '#22C55E', borderColor: '#22C55E' } },
      onOk: async () => {
        setApproving(true);
        try {
          await approveReimbursement(parseInt(id), reviewNote);
          message.success('审批已通过');
          fetchDetail(); fetchTimeline();
        } catch (e: any) { message.error('操作失败：' + (e.response?.data?.detail || e.message)); }
        finally { setApproving(false); }
      },
    });
  };

  const handleReject = async () => {
    if (!id) return;
    if (!rejectReason.trim()) { message.warning('驳回必须填写原因'); return; }
    setApproving(true);
    try {
      await rejectReimbursement(parseInt(id), rejectReason);
      message.success('已驳回');
      setRejectModalVisible(false);
      setRejectReason('');
      fetchDetail(); fetchTimeline();
    } catch (e: any) { message.error('操作失败：' + (e.response?.data?.detail || e.message)); }
    finally { setApproving(false); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!reimb) return <div style={{ textAlign: 'center', padding: 100 }}>报销单不存在</div>;

  const isAdmin = currentUser?.role === 'admin';
  const canReview = isAdmin && reimb.status === ReimbursementStatus.SUBMITTED;

  // 发票明细列
  const invoiceColumns: ColumnsType<Invoice> = [
    { title: '发票号码', dataIndex: 'invoice_number', key: 'invoice_number', render: (v) => v || '-' },
    { title: '开票日期', dataIndex: 'issue_date', key: 'issue_date', render: (v) => v || '-' },
    { title: '销售方', dataIndex: 'seller_name', key: 'seller_name', ellipsis: true, render: (v) => v || '-' },
    { title: '购买方', dataIndex: 'buyer_name', key: 'buyer_name', ellipsis: true, render: (v) => v || '-' },
    { title: '价税合计', dataIndex: 'total_with_tax', key: 'total_with_tax', align: 'right',
      render: (v: any) => v != null ? `¥${Number(v).toFixed(2)}` : '-' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: InvoiceStatus) => <Tag>{s}</Tag>,
    },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, minHeight: '100vh', background: '#f5f7fa' }}>
      {/* ====== 左栏 ====== */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 返回按钮 */}
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reimbursements')} style={{ marginBottom: 16 }}>
          返回台账
        </Button>

        {/* 报销单基本信息 */}
        <Card title="报销单信息" style={{ marginBottom: 24 }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="单号">{reimb.id}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={reimb.status === ReimbursementStatus.SUBMITTED ? 'warning' :
                reimb.status === ReimbursementStatus.APPROVED ? 'success' :
                reimb.status === ReimbursementStatus.REJECTED ? 'error' : 'default'}>
                {reimb.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="报销事由" span={2}>{reimb.title}</Descriptions.Item>
            <Descriptions.Item label="项目编号">{reimb.project_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="报销总金额">
              <span style={{ color: '#cf1322', fontWeight: 'bold' }}>¥{Number(reimb.total_amount).toFixed(2)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="提交人">{reimb.submitter || '-'}</Descriptions.Item>
            <Descriptions.Item label="审批人">{reimb.reviewer || '待审批'}</Descriptions.Item>
            {reimb.review_note && <Descriptions.Item label="审批意见" span={2}>{reimb.review_note}</Descriptions.Item>}
            {reimb.reject_reason && <Descriptions.Item label="驳回理由" span={2}>
              <span style={{ color: '#E42313' }}>{reimb.reject_reason}</span>
            </Descriptions.Item>}
            <Descriptions.Item label="AI 风险评级">
              {reimb.ai_risk_level ? <Tag color={String(reimb.ai_risk_level).includes('高') ? 'error' : 'success'}>{reimb.ai_risk_level}</Tag> : <span style={{ color: '#999' }}>未扫描</span>}
            </Descriptions.Item>
            <Descriptions.Item label="提交时间">{reimb.created_at ? new Date(reimb.created_at).toLocaleString() : '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        {/* 关联发票明细 */}
        <Card title={`关联发票 (${(reimb.invoices || []).length} 张)`}>
          <Table
            rowKey="id"
            columns={invoiceColumns}
            dataSource={reimb.invoices || []}
            pagination={false}
            size="small"
            expandable={{
              expandedRowRender: (inv: Invoice) => (
                <div style={{ padding: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>商品明细</div>
                  {inv.items && (inv.items as any[]).length > 0 ? (
                    <Table
                      rowKey={(_, i) => String(i)}
                      dataSource={inv.items as any[]}
                      columns={[
                        { title: '名称', dataIndex: 'item_name', key: 'item_name', render: (v: any) => v || '-' },
                        { title: '规格', dataIndex: 'specification', key: 'specification', render: (v: any) => v || '-' },
                        { title: '数量', dataIndex: 'quantity', key: 'quantity', render: (v: any) => v || '-' },
                        { title: '单价', dataIndex: 'unit_price', key: 'unit_price', render: (v: any) => v || '-' },
                        { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: any) => v || '-' },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  ) : <span style={{ color: '#999' }}>无明细</span>}
                </div>
              ),
            }}
          />
        </Card>
      </div>

      {/* ====== 右栏 ====== */}
      <div style={{ width: 420, flexShrink: 0 }}>
        {/* 资金追踪时间轴 */}
        <Card title={<span><ClockCircleOutlined /> 资金追踪时间轴</span>} style={{ marginBottom: 24 }}>
          {timeline.length === 0 ? <Empty description="暂无追踪记录" /> : (
            <Timeline>
              {timeline.map((node, idx) => (
                <Timeline.Item key={idx} color={statusColorMap[node.status]}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{node.title}</div>
                  <div style={{ color: '#999', fontSize: 11 }}>
                    {node.time ? new Date(node.time).toLocaleString() : ''}
                  </div>
                  <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{node.description}</div>
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </Card>

        {/* AI 审查结果 */}
        {aiCheckResult && (
          <Card
            title={<span><SafetyCertificateOutlined /> AI 审查报告</span>}
            style={{ marginBottom: 24, borderLeft: `4px solid ${aiCheckResult.compliance_status === '合规' ? '#22C55E' : '#EF4444'}` }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Tag color={aiCheckResult.compliance_status === '合规' ? 'success' : 'error'}>
                {aiCheckResult.compliance_status}
              </Tag>
              <Tag color={aiCheckResult.risk_level === '高' ? 'error' : aiCheckResult.risk_level === '中' ? 'warning' : 'success'}>
                风险等级：{aiCheckResult.risk_level}
              </Tag>
              <div style={{ color: '#333', fontSize: 13, marginTop: 8 }}>{aiCheckResult.reason}</div>
              {aiCheckResult.remarks && <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{aiCheckResult.remarks}</div>}
            </Space>
            {aiCheckResult.details?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {aiCheckResult.details.map((d: any, i: number) => (
                  <div key={i} style={{
                    padding: '8px 12px', marginBottom: 8, borderRadius: 6,
                    background: d.severity === '严重' ? '#fff2f0' : d.severity === '中等' ? '#fff7e6' : '#f6ffed',
                    border: `1px solid ${d.severity === '严重' ? '#ffccc7' : d.severity === '中等' ? '#ffd591' : '#b7eb8f'}`,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                      [{d.severity}] {d.issue}
                    </div>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{d.comment}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* 审批操作区（仅管理员 + 待审批状态） */}
        {canReview && (
          <Card title="审批操作" style={{ borderTop: '3px solid #E42313' }}>
            {/* AI 审查按钮 */}
            {!aiCheckResult && (
              <Button type="primary" icon={<RobotOutlined />} loading={aiChecking} onClick={handleAiCheck}
                block size="large" style={{ marginBottom: 16, background: '#E42313', borderColor: '#E42313' }}>
                启动 AI 合规审查
              </Button>
            )}

            {/* 风险/预算预警 */}
            {aiCheckResult?.risk_level && (aiCheckResult.risk_level === '高' || aiCheckResult.risk_level === '中') && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message={`⚠️ AI 风险评级：${aiCheckResult.risk_level}风险`}
                description={aiCheckResult.reason || '请仔细审查后再决定是否通过'} />
            )}
            {reimb.ai_risk_level && String(reimb.ai_risk_level).includes('高') && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message="⚠️ 该报销单 AI 审查判定为高风险" />
            )}

            {/* 审批意见 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>审批意见</div>
              <Input.TextArea
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="填写审批意见（选填）..."
              />
            </div>

            {/* 通过 / 驳回 */}
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button
                type="primary" icon={<CheckCircleOutlined />} loading={approving}
                onClick={handleApprove}
                style={{ background: '#22C55E', borderColor: '#22C55E', flex: 1 }}
                size="large"
              >
                审批通过
              </Button>
              <Button
                danger icon={<CloseCircleOutlined />}
                onClick={() => setRejectModalVisible(true)}
                size="large"
              >
                驳回
              </Button>
            </Space>
          </Card>
        )}

        {/* 已完成的审批信息 */}
        {reimb.status === ReimbursementStatus.APPROVED && (
          <Card title="审批结果" style={{ borderTop: '3px solid #22C55E' }}>
            <Tag color="success">已通过</Tag>
            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
              审批人：{reimb.reviewer || '-'}
            </div>
            {reimb.review_note && <div style={{ marginTop: 4, color: '#444', fontSize: 13 }}>意见：{reimb.review_note}</div>}
            {/* 借款冲销信息 */}
            {reimb.borrowing_info && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
                <span style={{ fontWeight: 600, color: '#d46b08' }}>关联借款：</span>
                <span>「{reimb.borrowing_info.title}」借款 ¥{reimb.borrowing_info.estimated_amount.toFixed(2)}</span>
                {reimb.borrowing_info.status === '已冲销' ? (
                  <Tag color="blue" style={{ marginLeft: 8 }}>已冲销 ¥{((reimb.borrowing_info.repaid_amount) || 0).toFixed(2)}</Tag>
                ) : (
                  <Tag color="orange" style={{ marginLeft: 8 }}>待冲销</Tag>
                )}
                {reimb.borrowing_info.repaid_amount !== null && reimb.borrowing_info.repaid_amount !== reimb.borrowing_info.estimated_amount && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#d46b08' }}>
                    {reimb.borrowing_info.repaid_amount > reimb.borrowing_info.estimated_amount
                      ? `报销金额超出借款 ¥${(reimb.borrowing_info.repaid_amount - reimb.borrowing_info.estimated_amount).toFixed(2)}，需补退`
                      : `尚有 ¥${(reimb.borrowing_info.estimated_amount - (reimb.borrowing_info.repaid_amount || 0)).toFixed(2)} 未冲销`}
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <PrintVoucher
                id={reimb.id}
                title={reimb.title}
                projectCode={reimb.project_code}
                amount={Number(reimb.total_amount)}
                submitter={reimb.submitter}
                reviewer={reimb.reviewer}
                reviewNote={reimb.review_note}
                bankCardInfo={reimb.bank_card_info || reimb.payment_bank}
                submitterSignature={reimb.submitter === currentUser?.username ? submitterSignature : null}
                reviewerSignature={reimb.reviewer_signature || null}
                items={(reimb.invoices?.[0] as any)?.items || []}
                invoiceNumbers={reimb.invoices?.map((inv: any) => inv.invoice_number).filter(Boolean)}
              />
              {isAdmin && (
                <Popconfirm
                  title="确认已打款？"
                  description="确认后报销单状态将变为「已打款」，员工将收到通知。"
                  onConfirm={async () => {
                    try {
                      const res = await completeReimbursement(reimb!.id);
                      setPaymentResult(res.payment || null);
                      message.success('已确认打款，模拟银企直联完成');
                      fetchDetail(); fetchTimeline();
                    } catch { message.error('操作失败'); }
                  }}
                  okText="确认打款"
                  cancelText="取消"
                >
                  <Button type="primary" size="large" icon={<DollarOutlined />}
                    style={{ background: '#1677ff', borderColor: '#1677ff', fontWeight: 600 }}>
                    确认线下打款
                  </Button>
                </Popconfirm>
              )}
            </div>
          </Card>
        )}
        {reimb.status === ReimbursementStatus.COMPLETED && (
          <>
            <PaymentVoucher reimb={reimb} payment={paymentResult} />
            <Card title="打款结果" style={{ borderTop: '3px solid #1677ff', marginTop: 16 }}>
              <Tag color="processing">已打款</Tag>
              <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
                报销款已打入员工收款账户，报销流程完成
              </div>
              {reimb.borrowing_info && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                  <span style={{ fontWeight: 600, color: '#389e0d' }}>借款冲销：</span>
                  <span>「{reimb.borrowing_info.title}」借款 ¥{reimb.borrowing_info.estimated_amount.toFixed(2)}</span>
                  <Tag color="blue" style={{ marginLeft: 8 }}>已冲销 ¥{((reimb.borrowing_info.repaid_amount) || 0).toFixed(2)}</Tag>
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <PrintVoucher
                  id={reimb.id} title={reimb.title}
                  projectCode={reimb.project_code}
                  amount={Number(reimb.total_amount)}
                  submitter={reimb.submitter}
                  reviewer={reimb.reviewer}
                  reviewNote={reimb.review_note}
                  bankCardInfo={reimb.bank_card_info || reimb.payment_bank}
                  submitterSignature={reimb.submitter === currentUser?.username ? submitterSignature : null}
                  reviewerSignature={reimb.reviewer_signature || null}
                  items={(reimb.invoices?.[0] as any)?.items || []}
                  invoiceNumbers={reimb.invoices?.map((inv: any) => inv.invoice_number).filter(Boolean)}
                />
              </div>
            </Card>
          </>
        )}
        {reimb.status === ReimbursementStatus.REJECTED && (
          <Card title="审批结果" style={{ borderTop: '3px solid #E42313' }}>
            <Tag color="error">已驳回</Tag>
            <div style={{ marginTop: 8, color: '#E42313', fontSize: 13 }}>
              理由：{reimb.reject_reason || '-'}
            </div>
          </Card>
        )}
      </div>

      {/* 驳回原因弹窗 */}
      <Modal
        title="驳回报销单"
        open={rejectModalVisible}
        onOk={handleReject}
        onCancel={() => { setRejectModalVisible(false); setRejectReason(''); }}
        okText="确认驳回"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={approving}
      >
        <div style={{ marginBottom: 8 }}>请填写驳回原因（必填）：</div>
        <Input.TextArea
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="必须填写驳回原因..."
        />
      </Modal>
    </div>
  );
}
