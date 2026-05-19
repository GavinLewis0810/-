import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EyeOutlined,
  FileSearchOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  RotateRightOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api, {
  aiCheckReimbursement,
  approveReimbursement,
  completeReimbursement,
  getReimbursementDetail,
  getReimbursementTimeline,
  rejectReimbursement,
} from '../services/api';
import PrintVoucher from '../components/PrintVoucher';
import PaymentVoucher from '../components/PaymentVoucher';
import { Invoice, InvoiceStatus, Reimbursement, ReimbursementStatus } from '../types/invoice';

type ReviewDecision = 'ocr' | 'llm' | 'custom';

type ReviewFieldRow = {
  key: string;
  fieldName: string;
  ocrValue: string;
  llmValue: string;
  finalValue: string;
  source: ReviewDecision;
  rawField: string;
};

type ReviewDraftField = ReviewFieldRow & {
  draftSource: ReviewDecision;
  draftValue: string;
};

const formatCurrency = (value?: number | null) => `¥${Number(value || 0).toFixed(2)}`;
const getInvoicePreviewUrl = (invoiceId: number) => `/api/invoices/${invoiceId}/preview`;
const getInvoiceFileOpenUrl = (invoiceId: number) => `/api/invoices/${invoiceId}/file`;

const getReviewSourceLabel = (source: ReviewDecision) => {
  if (source === 'ocr') return '选 OCR';
  if (source === 'llm') return '选 LLM';
  return '自定义';
};

const getInvoiceDisplayValue = (invoice: Invoice, field: string) => {
  const value = (invoice as any)?.[field];
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const buildReviewFieldRows = (invoice: Invoice): ReviewFieldRow[] => {
  const selectedFields = invoice.selection_fields || [];
  const fieldStates = invoice.field_states || {};

  return selectedFields.map((field) => {
    const state = fieldStates[field];
    const ocrValue = state?.ocr ?? '-';
    const llmValue = state?.llm ?? '-';
    const finalValue = getInvoiceDisplayValue(invoice, field);

    let source: ReviewDecision = 'custom';
    if (finalValue === String(state?.ocr ?? '')) {
      source = 'ocr';
    } else if (finalValue === String(state?.llm ?? '')) {
      source = 'llm';
    }

    return {
      key: `${invoice.id}-${field}`,
      fieldName: state?.label || field,
      rawField: field,
      ocrValue: ocrValue === '-' ? '-' : String(ocrValue),
      llmValue: llmValue === '-' ? '-' : String(llmValue),
      finalValue,
      source,
    };
  });
};

const getVoucherReviewTrace = (invoice: Invoice) =>
  ((invoice.decision_trace || {}).voucher_review || {}) as Record<string, any>;

const getInvoiceRiskMeta = (invoice: Invoice) => {
  const reviewTrace = getVoucherReviewTrace(invoice);
  const reviewed = Boolean(reviewTrace.reviewed);

  const isBlocked =
    invoice.status === InvoiceStatus.PENDING_RECHECK || invoice.confirmation_mode === 'USER_EDIT';
  const needsVoucherReview =
    invoice.status === InvoiceStatus.PENDING_VOUCHER_REVIEW ||
    invoice.confirmation_mode === 'USER_SELECTION' ||
    invoice.confirmation_mode === 'ADMIN_CORRECTION';

  if (isBlocked) {
    return {
      level: 'blocked' as const,
      label: '待重审',
      color: 'error',
      description: '用户手工修正过字段，需先管理员复核',
      reviewed: false,
    };
  }

  if (needsVoucherReview && invoice.confirmation_mode === 'ADMIN_CORRECTION') {
    return {
      level: 'admin_corrected' as const,
      label: reviewed ? '已复核修正' : '待复核修正',
      color: reviewed ? 'processing' : 'gold',
      description: '管理员已介入修正或正在修正中',
      reviewed,
    };
  }

  if (needsVoucherReview) {
    return {
      level: 'voucher_review' as const,
      label: reviewed ? '已核对原票' : '待随单审核',
      color: reviewed ? 'processing' : 'gold',
      description: reviewed ? '已完成原票核对' : '含 OCR/LLM/自定义人工确认字段',
      reviewed,
    };
  }

  return {
    level: 'normal' as const,
    label: invoice.confirmation_mode === 'AUTO' ? '自动确认' : '正常',
    color: 'success',
    description: '未发现人工确认风险',
    reviewed: true,
  };
};

const statusColorMap: Record<string, string> = {
  done: '#22C55E',
  processing: '#1677ff',
  pending: '#d9d9d9',
  error: '#E42313',
};

const isHighRisk = (risk?: string | null) => {
  if (!risk) return false;
  const text = String(risk).toLowerCase();
  return text.includes('高') || text.includes('high') || text.includes('严重');
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
  const [approving, setApproving] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [drawerScale, setDrawerScale] = useState(1);
  const [drawerRotation, setDrawerRotation] = useState(0);
  const [drawerNote, setDrawerNote] = useState('');
  const [drawerReviewed, setDrawerReviewed] = useState(true);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [draftFields, setDraftFields] = useState<ReviewDraftField[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('currentUser');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const submitterSignature = currentUser?.signature || null;

  const fetchDetail = async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const data = await getReimbursementDetail(parseInt(id, 10));
      setReimb(data);
      if (data.ai_review_detail) setAiCheckResult(data.ai_review_detail);
      if (data.payment_transaction_id) {
        setPaymentResult({
          transaction_id: data.payment_transaction_id,
          to_bank: data.payment_bank,
          transfer_time: data.payment_time,
        });
      }
    } catch {
      if (!silent) message.error('获取报销单详情失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchTimeline = async () => {
    if (!id) return;
    try {
      const res = await getReimbursementTimeline(parseInt(id, 10));
      setTimeline(res.timeline);
    } catch {
      setTimeline([]);
    }
  };

  useEffect(() => {
    fetchDetail();
    fetchTimeline();
    pollingRef.current = setInterval(() => {
      fetchDetail(true);
      fetchTimeline();
    }, 10000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [id]);

  useEffect(() => {
    if (!activeInvoice || !reimb?.invoices) return;
    const fresh = reimb.invoices.find((invoice) => invoice.id === activeInvoice.id);
    if (fresh) setActiveInvoice(fresh);
  }, [activeInvoice?.id, reimb?.invoices]);

  const reviewSummary = useMemo(() => {
    const invoices = reimb?.invoices || [];
    const blockedInvoices = invoices.filter((invoice) => getInvoiceRiskMeta(invoice).level === 'blocked');
    const selectionInvoices = invoices.filter((invoice) => {
      const level = getInvoiceRiskMeta(invoice).level;
      return level === 'voucher_review' || level === 'admin_corrected';
    });
    const reviewedInvoices = selectionInvoices.filter((invoice) => getInvoiceRiskMeta(invoice).reviewed);
    const selectedFieldsCount = selectionInvoices.reduce(
      (sum, invoice) => sum + (invoice.selection_fields?.length || 0),
      0,
    );

    return {
      invoiceCount: invoices.length,
      blockedInvoices,
      selectionInvoices,
      reviewedInvoices,
      selectedFieldsCount,
      hasBlocked: blockedInvoices.length > 0,
      needsVoucherReview: selectionInvoices.length > 0,
      allReviewed: selectionInvoices.length > 0 ? reviewedInvoices.length === selectionInvoices.length : true,
    };
  }, [reimb]);

  const autoApproveBlocked = useMemo(() => {
    if (!aiCheckResult?.auto_approve_blocked) return null;
    return {
      blocked: true,
      reason: aiCheckResult.auto_approve_block_reason || '',
    };
  }, [aiCheckResult]);

  const handleAiCheck = async () => {
    if (!id) return;
    setAiChecking(true);
    try {
      const res = await aiCheckReimbursement(parseInt(id, 10));
      setAiCheckResult(res);
      message.success('AI 审查完成');
      fetchTimeline();
    } catch (e: any) {
      message.error(`审查失败：${e.response?.data?.detail || e.message}`);
    } finally {
      setAiChecking(false);
    }
  };

  const openInvoiceReviewDrawer = (invoice: Invoice) => {
    const trace = getVoucherReviewTrace(invoice);
    const rows = buildReviewFieldRows(invoice);
    setActiveInvoice(invoice);
    setDrawerScale(1);
    setDrawerRotation(0);
    setDrawerReviewed(Boolean(trace.reviewed) || rows.length === 0);
    setDrawerNote(String(trace.review_note || ''));
    setDraftFields(
      rows.map((row) => ({
        ...row,
        draftSource: row.source,
        draftValue: row.finalValue === '-' ? '' : row.finalValue,
      })),
    );
    setReviewDrawerOpen(true);
  };

  const closeInvoiceReviewDrawer = () => {
    setReviewDrawerOpen(false);
    setActiveInvoice(null);
    setDrawerNote('');
    setDraftFields([]);
  };

  const updateDraftField = (fieldKey: string, patch: Partial<ReviewDraftField>) => {
    setDraftFields((prev) =>
      prev.map((item) => (item.key === fieldKey ? { ...item, ...patch } : item)),
    );
  };

  const applyDraftSource = (fieldKey: string, source: ReviewDecision) => {
    const row = draftFields.find((item) => item.key === fieldKey);
    if (!row) return;
    if (source === 'ocr') {
      updateDraftField(fieldKey, { draftSource: source, draftValue: row.ocrValue === '-' ? '' : row.ocrValue });
      return;
    }
    if (source === 'llm') {
      updateDraftField(fieldKey, { draftSource: source, draftValue: row.llmValue === '-' ? '' : row.llmValue });
      return;
    }
    updateDraftField(fieldKey, { draftSource: source });
  };

  const handleSaveVoucherReview = async () => {
    if (!id || !activeInvoice) return;
    if (!drawerReviewed) {
      message.warning('请先勾选“我已核对该发票原票”');
      return;
    }

    const fieldUpdates = draftFields
      .filter((field) => {
        const sourceChanged = field.draftSource !== field.source;
        const valueChanged = (field.draftValue || '') !== (field.finalValue === '-' ? '' : field.finalValue);
        return sourceChanged || valueChanged;
      })
      .map((field) => ({
        field_name: field.rawField,
        source: field.draftSource,
        value: field.draftSource === 'custom' ? field.draftValue : undefined,
      }));

    setDrawerSaving(true);
    try {
      const res = await api.put(
        `/reimbursements/${id}/invoices/${activeInvoice.id}/voucher-review`,
        {
          review_note: drawerNote,
          mark_reviewed: drawerReviewed,
          field_updates: fieldUpdates,
        },
      );
      message.success(res.data?.message || '该票复核已保存');
      await fetchDetail(true);
      await fetchTimeline();
      closeInvoiceReviewDrawer();
    } catch (e: any) {
      message.error(`保存失败：${e.response?.data?.detail || e.message}`);
    } finally {
      setDrawerSaving(false);
    }
  };

  const handleApprove = () => {
    if (!id) return;

    if (reviewSummary.hasBlocked) {
      message.error('当前报销单含待重审发票，不能继续审批');
      return;
    }

    if (reviewSummary.needsVoucherReview && !reviewSummary.allReviewed) {
      message.warning('请先完成所有待随单审核发票的原票复核');
      return;
    }

    const risks: string[] = [];
    if (reviewSummary.needsVoucherReview) {
      risks.push(
        `本单已复核 ${reviewSummary.reviewedInvoices.length} / ${reviewSummary.selectionInvoices.length} 张人工确认发票`,
      );
    }
    if (aiCheckResult?.risk_level && isHighRisk(aiCheckResult.risk_level)) {
      risks.push(`AI 风险等级：${aiCheckResult.risk_level}，${aiCheckResult.reason || ''}`);
    }

    Modal.confirm({
      title: risks.length > 0 ? '确认审批通过（含复核提醒）' : '确认审批通过',
      content:
        risks.length > 0 ? (
          <div>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="请确认以下信息"
              description={risks.join('\n')}
            />
            <p>确定继续通过当前报销单吗？</p>
          </div>
        ) : (
          '确定要通过当前报销单吗？'
        ),
      okText: '确认通过',
      cancelText: '取消',
      okButtonProps: { style: { background: '#22C55E', borderColor: '#22C55E' } },
      onOk: async () => {
        setApproving(true);
        try {
          await approveReimbursement(parseInt(id, 10), reviewNote);
          message.success('审批已通过');
          fetchDetail();
          fetchTimeline();
        } catch (e: any) {
          message.error(`操作失败：${e.response?.data?.detail || e.message}`);
        } finally {
          setApproving(false);
        }
      },
    });
  };

  const handleReject = async () => {
    if (!id) return;
    if (!rejectReason.trim()) {
      message.warning('驳回必须填写原因');
      return;
    }
    setApproving(true);
    try {
      await rejectReimbursement(parseInt(id, 10), rejectReason);
      message.success('已驳回');
      setRejectModalVisible(false);
      setRejectReason('');
      closeInvoiceReviewDrawer();
      fetchDetail();
      fetchTimeline();
    } catch (e: any) {
      message.error(`操作失败：${e.response?.data?.detail || e.message}`);
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!reimb) {
    return <div style={{ textAlign: 'center', padding: 100 }}>报销单不存在</div>;
  }

  const isAdmin = currentUser?.role === 'admin';
  const canReview = isAdmin && reimb.status === ReimbursementStatus.SUBMITTED;
  const activeInvoiceIsPdf = activeInvoice?.file_type?.toLowerCase() === 'pdf';

  const invoiceColumns: ColumnsType<Invoice> = [
    {
      title: '发票号码',
      dataIndex: 'invoice_number',
      key: 'invoice_number',
      render: (value) => value || '-',
    },
    {
      title: '开票日期',
      dataIndex: 'issue_date',
      key: 'issue_date',
      render: (value) => value || '-',
    },
    {
      title: '销售方',
      dataIndex: 'seller_name',
      key: 'seller_name',
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: '购买方',
      dataIndex: 'buyer_name',
      key: 'buyer_name',
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: '价税合计',
      dataIndex: 'total_with_tax',
      key: 'total_with_tax',
      align: 'right',
      render: (value) => (value != null ? formatCurrency(Number(value)) : '-'),
    },
    {
      title: '确认路径',
      key: 'confirmation_mode',
      width: 130,
      render: (_, invoice) => {
        if (invoice.confirmation_mode === 'ADMIN_CORRECTION') {
          return <Tag color="processing">管理员修正</Tag>;
        }
        if (invoice.confirmation_mode === 'USER_SELECTION') {
          return <Tag color="gold">人工确认</Tag>;
        }
        if (invoice.confirmation_mode === 'USER_EDIT') {
          return <Tag color="error">手工修正</Tag>;
        }
        return <Tag color="success">自动确认</Tag>;
      },
    },
    {
      title: '复核状态',
      key: 'review_state',
      width: 140,
      render: (_, invoice) => {
        const meta = getInvoiceRiskMeta(invoice);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
  ];

  const reviewFieldColumns: ColumnsType<ReviewFieldRow> = [
    { title: '字段', dataIndex: 'fieldName', key: 'fieldName', width: 120 },
    { title: 'OCR', dataIndex: 'ocrValue', key: 'ocrValue', ellipsis: true },
    { title: 'LLM', dataIndex: 'llmValue', key: 'llmValue', ellipsis: true },
    { title: '最终采用值', dataIndex: 'finalValue', key: 'finalValue', ellipsis: true },
    {
      title: '决策来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (source: ReviewDecision) => (
        <Tag color={source === 'custom' ? 'purple' : source === 'ocr' ? 'blue' : 'cyan'}>
          {getReviewSourceLabel(source)}
        </Tag>
      ),
    },
  ];

  const draftColumns: ColumnsType<ReviewDraftField> = [
    { title: '字段', dataIndex: 'fieldName', key: 'fieldName', width: 96 },
    { title: 'OCR', dataIndex: 'ocrValue', key: 'ocrValue', width: 120, ellipsis: true },
    { title: 'LLM', dataIndex: 'llmValue', key: 'llmValue', width: 120, ellipsis: true },
    {
      title: '管理员定稿',
      key: 'draft',
      render: (_, row) => (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Space wrap>
            <Button
              size="small"
              type={row.draftSource === 'ocr' ? 'primary' : 'default'}
              onClick={() => applyDraftSource(row.key, 'ocr')}
            >
              采用 OCR
            </Button>
            <Button
              size="small"
              type={row.draftSource === 'llm' ? 'primary' : 'default'}
              onClick={() => applyDraftSource(row.key, 'llm')}
            >
              采用 LLM
            </Button>
            <Button
              size="small"
              type={row.draftSource === 'custom' ? 'primary' : 'default'}
              onClick={() => applyDraftSource(row.key, 'custom')}
            >
              手动修正
            </Button>
          </Space>
          <Input
            size="small"
            value={row.draftValue}
            disabled={row.draftSource !== 'custom'}
            onChange={(e) => updateDraftField(row.key, { draftValue: e.target.value })}
            placeholder="输入管理员修正值"
          />
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, minHeight: '100vh', background: '#f5f7fa' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/reimbursements')}
          style={{ marginBottom: 16 }}
        >
          返回台账
        </Button>

        <Card title="报销单信息" style={{ marginBottom: 24 }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="单号">{reimb.id}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag
                color={
                  reimb.status === ReimbursementStatus.SUBMITTED
                    ? 'warning'
                    : reimb.status === ReimbursementStatus.APPROVED
                      ? 'success'
                      : reimb.status === ReimbursementStatus.REJECTED
                        ? 'error'
                        : reimb.status === ReimbursementStatus.COMPLETED
                          ? 'processing'
                          : 'default'
                }
              >
                {reimb.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="报销事由" span={2}>
              {reimb.title}
            </Descriptions.Item>
            <Descriptions.Item label="项目编号">{reimb.project_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="报销总金额">
              <span style={{ color: '#cf1322', fontWeight: 'bold' }}>
                {formatCurrency(reimb.total_amount)}
              </span>
            </Descriptions.Item>
            {reimb.carbon_kg != null && (
              <Descriptions.Item label="碳足迹合计">
                <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                  {Number(reimb.carbon_kg).toFixed(4)} kg CO₂
                </span>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="提交人">{reimb.submitter || '-'}</Descriptions.Item>
            <Descriptions.Item label="审批人">{reimb.reviewer || '待审批'}</Descriptions.Item>
            {reimb.review_note && (
              <Descriptions.Item label="审批意见" span={2}>
                {reimb.review_note}
              </Descriptions.Item>
            )}
            {reimb.reject_reason && (
              <Descriptions.Item label="驳回理由" span={2}>
                <span style={{ color: '#E42313' }}>{reimb.reject_reason}</span>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="AI 风险等级">
              {reimb.ai_risk_level ? (
                <Tag color={isHighRisk(reimb.ai_risk_level) ? 'error' : 'success'}>
                  {reimb.ai_risk_level}
                </Tag>
              ) : (
                <span style={{ color: '#999' }}>未审查</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="提交时间">
              {reimb.created_at ? new Date(reimb.created_at).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 16 }}>
            {autoApproveBlocked && (
              <Alert
                type="warning"
                showIcon
                message="AI 自动审批已阻止"
                description={autoApproveBlocked.reason}
                style={{ marginBottom: 12 }}
              />
            )}
            {reviewSummary.hasBlocked ? (
              <Alert
                type="error"
                showIcon
                message="本单存在待重审发票"
                description="这类发票不应继续进入正常审批流，建议先核查发票确认状态。"
              />
            ) : reviewSummary.needsVoucherReview ? (
              <Alert
                type={reviewSummary.allReviewed ? 'success' : 'warning'}
                showIcon
                message={`本单含 ${reviewSummary.selectionInvoices.length} 张随单复核发票`}
                description={`已完成 ${reviewSummary.reviewedInvoices.length} / ${reviewSummary.selectionInvoices.length} 张原票复核，共涉及 ${reviewSummary.selectedFieldsCount} 个人工确认字段。`}
              />
            ) : (
              <Alert
                type="success"
                showIcon
                message="本单关联发票均为自动确认"
                description="可以按常规报销审批流程处理。"
              />
            )}
          </div>
        </Card>

        <Card title={`关联发票（${reviewSummary.invoiceCount} 张）`} style={{ marginBottom: 24 }}>
          <Table
            rowKey="id"
            columns={invoiceColumns}
            dataSource={reimb.invoices || []}
            pagination={false}
            size="small"
          />
        </Card>

        <Card title="随单复核" style={{ marginBottom: 24 }}>
          {reviewSummary.needsVoucherReview ? (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <Card size="small">
                  <div style={{ color: '#8c8c8c', marginBottom: 8 }}>待随单审核发票</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#d48806' }}>
                    {reviewSummary.selectionInvoices.length}
                  </div>
                </Card>
                <Card size="small">
                  <div style={{ color: '#8c8c8c', marginBottom: 8 }}>已完成复核</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#1677ff' }}>
                    {reviewSummary.reviewedInvoices.length}
                  </div>
                </Card>
                <Card size="small">
                  <div style={{ color: '#8c8c8c', marginBottom: 8 }}>人工确认字段</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{reviewSummary.selectedFieldsCount}</div>
                </Card>
              </div>

              {reviewSummary.selectionInvoices.map((invoice) => {
                const rows = buildReviewFieldRows(invoice);
                const meta = getInvoiceRiskMeta(invoice);
                return (
                  <Card
                    key={invoice.id}
                    size="small"
                    title={
                      <Space wrap>
                        <span>发票 {invoice.invoice_number || `#${invoice.id}`}</span>
                        <Tag color={meta.color}>{meta.label}</Tag>
                      </Space>
                    }
                    extra={
                      <Button
                        type="link"
                        size="small"
                        icon={<FileSearchOutlined />}
                        onClick={() => openInvoiceReviewDrawer(invoice)}
                      >
                        原票复核
                      </Button>
                    }
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div style={{ color: '#8c8c8c', marginBottom: 4 }}>销售方</div>
                        <div>{invoice.seller_name || '-'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#8c8c8c', marginBottom: 4 }}>价税合计</div>
                        <div>{formatCurrency(invoice.total_with_tax)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#8c8c8c', marginBottom: 4 }}>确认方式</div>
                        <div>
                          {invoice.confirmation_mode === 'ADMIN_CORRECTION'
                            ? '管理员修正定稿'
                            : 'OCR/LLM/自定义人工确认'}
                        </div>
                      </div>
                    </div>

                    <Table
                      rowKey="key"
                      columns={reviewFieldColumns}
                      dataSource={rows}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                );
              })}
            </Space>
          ) : reviewSummary.hasBlocked ? (
            <Alert
              type="error"
              showIcon
              message="本单存在待重审发票"
              description="当前不适合继续常规审批，请先回到发票确认流处理阻断项。"
            />
          ) : (
            <Empty description="本单没有需要随单复核的发票" />
          )}
        </Card>
      </div>

      <div style={{ width: 420, flexShrink: 0 }}>
        {canReview && (
          <Card title="审批动作" style={{ borderTop: '3px solid #1677ff', marginBottom: 24 }}>
            {!aiCheckResult && (
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={aiChecking}
                onClick={handleAiCheck}
                block
                size="large"
                style={{ marginBottom: 16, background: '#1677ff', borderColor: '#1677ff' }}
              >
                启动 AI 合规审查
              </Button>
            )}

            {autoApproveBlocked && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="AI 自动审批已阻止"
                description={autoApproveBlocked.reason}
              />
            )}

            {reviewSummary.hasBlocked && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message="存在待重审发票，当前不允许审批通过"
              />
            )}

            {reviewSummary.needsVoucherReview && (
              <Alert
                type={reviewSummary.allReviewed ? 'success' : 'warning'}
                showIcon
                style={{ marginBottom: 12 }}
                message={`随单复核进度：${reviewSummary.reviewedInvoices.length} / ${reviewSummary.selectionInvoices.length}`}
                description={
                  reviewSummary.allReviewed
                    ? '所有人工确认发票已核对完毕，可以继续审批。'
                    : '请先完成全部原票复核，再执行审批通过。'
                }
              />
            )}

            {aiCheckResult?.risk_level && isHighRisk(aiCheckResult.risk_level) && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message={`AI 风险等级：${aiCheckResult.risk_level}`}
                description={aiCheckResult.reason || '请仔细核查后再决定是否通过'}
              />
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>审批意见</div>
              <Input.TextArea
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="填写审批意见（选填）"
              />
            </div>

            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={approving}
                onClick={handleApprove}
                style={{ background: '#22C55E', borderColor: '#22C55E', flex: 1 }}
                size="large"
                disabled={reviewSummary.hasBlocked || !reviewSummary.allReviewed}
              >
                审批通过
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => setRejectModalVisible(true)}
                size="large"
              >
                驳回整单
              </Button>
            </Space>
          </Card>
        )}

        {aiCheckResult && (
          <Card
            title={
              <span>
                <SafetyCertificateOutlined /> AI 审查报告
              </span>
            }
            style={{
              marginBottom: 24,
              borderLeft: `4px solid ${aiCheckResult.compliance_status === '合规' ? '#22C55E' : '#EF4444'}`,
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Tag color={aiCheckResult.compliance_status === '合规' ? 'success' : 'error'}>
                {aiCheckResult.compliance_status}
              </Tag>
              <Tag color={isHighRisk(aiCheckResult.risk_level) ? 'error' : 'success'}>
                风险等级：{aiCheckResult.risk_level}
              </Tag>
              <div style={{ color: '#333', fontSize: 13, marginTop: 8 }}>{aiCheckResult.reason}</div>
              {aiCheckResult.remarks && (
                <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{aiCheckResult.remarks}</div>
              )}
            </Space>
          </Card>
        )}

        <Card
          title={
            <span>
              <ClockCircleOutlined /> 资金追踪时间轴
            </span>
          }
          style={{ marginBottom: 24 }}
        >
          {timeline.length === 0 ? (
            <Empty description="暂无追踪记录" />
          ) : (
            <Timeline>
              {timeline.map((node, index) => (
                <Timeline.Item key={index} color={statusColorMap[node.status]}>
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

        {reimb.status === ReimbursementStatus.APPROVED && (
          <Card title="审批结果" style={{ borderTop: '3px solid #22C55E' }}>
            <Tag color="success">已通过</Tag>
            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>审批人：{reimb.reviewer || '-'}</div>
            {reimb.review_note && (
              <div style={{ marginTop: 4, color: '#444', fontSize: 13 }}>意见：{reimb.review_note}</div>
            )}
            {reimb.borrowing_info && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#fff7e6',
                  borderRadius: 6,
                  border: '1px solid #ffd591',
                }}
              >
                <span style={{ fontWeight: 600, color: '#d46b08' }}>关联借款：</span>
                <span>
                  《{reimb.borrowing_info.title}》借款 {formatCurrency(reimb.borrowing_info.estimated_amount)}
                </span>
                {reimb.borrowing_info.status === '已冲销' ? (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    已冲销 {formatCurrency(reimb.borrowing_info.repaid_amount || 0)}
                  </Tag>
                ) : (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    待冲销
                  </Tag>
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
                invoiceNumbers={reimb.invoices?.map((invoice: any) => invoice.invoice_number).filter(Boolean)}
              />
              {isAdmin && (
                <Popconfirm
                  title="确认已打款？"
                  description="确认后报销单状态将变为“已打款”。"
                  onConfirm={async () => {
                    try {
                      const res = await completeReimbursement(reimb.id);
                      setPaymentResult(res.payment || null);
                      message.success('已确认打款');
                      fetchDetail();
                      fetchTimeline();
                    } catch {
                      message.error('操作失败');
                    }
                  }}
                  okText="确认打款"
                  cancelText="取消"
                >
                  <Button
                    type="primary"
                    size="large"
                    icon={<DollarOutlined />}
                    style={{ background: '#1677ff', borderColor: '#1677ff', fontWeight: 600 }}
                  >
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
                报销款已打入员工收款账户，报销流程完成。
              </div>
              <div style={{ marginTop: 16 }}>
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
                  invoiceNumbers={reimb.invoices?.map((invoice: any) => invoice.invoice_number).filter(Boolean)}
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

      <Drawer
        title={
          <Space wrap>
            <span>原票复核</span>
            {activeInvoice && <Tag color={getInvoiceRiskMeta(activeInvoice).color}>{getInvoiceRiskMeta(activeInvoice).label}</Tag>}
          </Space>
        }
        placement="right"
        width="76vw"
        open={reviewDrawerOpen}
        onClose={closeInvoiceReviewDrawer}
      >
        {activeInvoice && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 1fr)',
              gap: 20,
              minHeight: 'calc(100vh - 160px)',
            }}
          >
            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#f7f8fa',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 680,
              }}
            >
              <div
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  background: '#fff',
                }}
              >
                <Space wrap>
                  <Button icon={<MinusOutlined />} onClick={() => setDrawerScale((v) => Math.max(0.6, v - 0.1))} />
                  <Button icon={<PlusOutlined />} onClick={() => setDrawerScale((v) => Math.min(2.4, v + 0.1))} />
                  <Button icon={<RotateRightOutlined />} onClick={() => setDrawerRotation((v) => v + 90)} />
                  <Button icon={<ReloadOutlined />} onClick={() => {
                    setDrawerScale(1);
                    setDrawerRotation(0);
                  }}>
                    还原
                  </Button>
                </Space>
                <Button icon={<EyeOutlined />} onClick={() => window.open(getInvoiceFileOpenUrl(activeInvoice.id), '_blank')}>
                  新窗口打开
                </Button>
              </div>

              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                }}
              >
                {activeInvoiceIsPdf ? (
                  <iframe
                    src={getInvoicePreviewUrl(activeInvoice.id)}
                    title={`invoice-${activeInvoice.id}`}
                    style={{ width: '100%', height: '100%', minHeight: 620, border: 'none', background: '#fff' }}
                  />
                ) : (
                  <img
                    src={getInvoicePreviewUrl(activeInvoice.id)}
                    alt={activeInvoice.file_name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      background: '#fff',
                      boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
                      transform: `scale(${drawerScale}) rotate(${drawerRotation}deg)`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card size="small" title="发票摘要">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="发票号码">{activeInvoice.invoice_number || '-'}</Descriptions.Item>
                  <Descriptions.Item label="销售方">{activeInvoice.seller_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="购买方">{activeInvoice.buyer_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="价税合计">{formatCurrency(activeInvoice.total_with_tax)}</Descriptions.Item>
                  <Descriptions.Item label="确认路径">
                    {activeInvoice.confirmation_mode === 'ADMIN_CORRECTION'
                      ? '管理员修正定稿'
                      : 'OCR / LLM / 自定义人工确认'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              <Alert
                type="warning"
                showIcon
                message="本票存在人工确认字段，请对照原票核验"
                description="左边查看原始票面，右边直接采用 OCR、采用 LLM 或手动修正并保存。"
              />

              <Card size="small" title="管理员定稿">
                <Table
                  rowKey="key"
                  columns={draftColumns}
                  dataSource={draftFields}
                  pagination={false}
                  size="small"
                  scroll={{ y: 280 }}
                />
              </Card>

              <Card size="small" title="复核动作">
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Checkbox checked={drawerReviewed} onChange={(e) => setDrawerReviewed(e.target.checked)}>
                    我已核对该发票原票
                  </Checkbox>
                  <Input.TextArea
                    rows={3}
                    value={drawerNote}
                    onChange={(e) => setDrawerNote(e.target.value)}
                    placeholder="填写这张发票的复核备注（选填）"
                  />
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={drawerSaving}
                      onClick={handleSaveVoucherReview}
                    >
                      修正并保存
                    </Button>
                    <Button
                      danger
                      icon={<CloseCircleOutlined />}
                      onClick={() => {
                        closeInvoiceReviewDrawer();
                        setRejectModalVisible(true);
                      }}
                    >
                      驳回整单
                    </Button>
                  </Space>
                </Space>
              </Card>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        title="驳回报销单"
        open={rejectModalVisible}
        onOk={handleReject}
        onCancel={() => {
          setRejectModalVisible(false);
          setRejectReason('');
        }}
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
