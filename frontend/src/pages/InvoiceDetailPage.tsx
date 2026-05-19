import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Descriptions,
  Button,
  message,
  Spin,
  Row,
  Col,
  Form,
  Input,
  Modal,
  Table,
  Card,
  Tooltip,
  Space,
  Alert,
  Tag,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  PlusOutlined,
  MinusCircleOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  BugOutlined,
  FundOutlined,
  EyeOutlined,
  FileImageOutlined,
  SoundOutlined,
  UpOutlined,
  DownOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ColumnWidthOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import { getInvoice, getInvoiceFileUrl, resolveDiff, confirmInvoice, reprocessInvoice, verifyInvoice, saveGroundTruth, applySubjectReview } from '../services/api';
import type { InvoiceDetail, SubjectReviewScheme, SubjectReviewTrace, SubjectReviewApplyResponse } from '../types/invoice';
import StatusTag from '../components/StatusTag';
import styles from './InvoiceDetailPage.module.css';

const fieldLabels: Record<string, string> = {
  invoice_number: '发票号码',
  issue_date: '开票日期',
  buyer_name: '购买方名称',
  buyer_tax_id: '购买方纳税人识别号',
  seller_name: '销售方名称',
  seller_tax_id: '销售方纳税人识别号',
  total_with_tax: '价税合计',
  amount: '总金额',
  tax_rate: '税率',
  tax_amount: '总税额',
};

const subjectFields = ['buyer_name', 'buyer_tax_id', 'seller_name', 'seller_tax_id'] as const;

function getSubjectRiskTag(level?: string) {
  if (level === 'high') return <StatusTag status="error">高风险待人工复核</StatusTag>;
  if (level === 'medium') return <StatusTag status="warning">中风险建议确认</StatusTag>;
  return <StatusTag status="success">主体信息已自动通过</StatusTag>;
}

function findSubjectScheme(subjectReview: SubjectReviewTrace | null | undefined, key?: string | null) {
  if (!subjectReview || !key) return null;
  return subjectReview.candidate_schemes?.find((item) => item.key === key) || null;
}

// 💡 商品明细表格的列定义
const itemColumns = [
  { title: '项目名称', dataIndex: 'item_name', key: 'item_name', render: (v: any) => v || '-' },
  { title: '规格型号', dataIndex: 'specification', key: 'specification', render: (v: any) => v || '-' },
  { title: '单位', dataIndex: 'unit', key: 'unit', render: (v: any) => v || '-' },
  { title: '数量', dataIndex: 'quantity', key: 'quantity', render: (v: any) => v || '-' },
  { title: '单价', dataIndex: 'unit_price', key: 'unit_price', render: (v: any) => v || '-' },
  { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: any) => v || '-' },
  { title: '税率', dataIndex: 'tax_rate', key: 'tax_rate', render: (v: any) => v || '-' },
  { title: '税额', dataIndex: 'tax_amount', key: 'tax_amount', render: (v: any) => v || '-' },
];

// 🔍 取证检测器小徽章
function ForensicsDetectorBadge({ icon, name, suspicious, findings, span }: {
  icon: React.ReactNode;
  name: string;
  suspicious?: boolean;
  findings?: string[];
  span?: number;
}) {
  return (
    <Tooltip title={findings && findings.length > 0 ? findings.join('；') : undefined}>
      <div style={{
        padding: '6px 10px',
        borderRadius: 4,
        background: suspicious ? '#fff2f0' : '#f6ffed',
        border: `1px solid ${suspicious ? '#ffccc7' : '#b7eb8f'}`,
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        gridColumn: span ? `span ${span}` : undefined,
        cursor: findings && findings.length > 0 ? 'help' : 'default',
      }}>
        {icon}
        <span style={{ fontWeight: 500 }}>{name}</span>
        <span style={{
          marginLeft: 'auto',
          color: suspicious ? '#cf1322' : '#389e0d',
          fontWeight: 'bold',
          fontSize: 11,
        }}>
          {suspicious ? '⚠ 异常' : '✓ 正常'}
        </span>
      </div>
    </Tooltip>
  );
}

function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form] = Form.useForm();
  const [resolvingDiff, setResolvingDiff] = useState<number | null>(null);
  const [customValueModal, setCustomValueModal] = useState<{ visible: boolean; diffId: number | null; fieldName: string }>({
    visible: false,
    diffId: null,
    fieldName: '',
  });
  const [customValue, setCustomValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; message: string; stored_hash: string; current_hash: string } | null>(null);
  const [subjectApplying, setSubjectApplying] = useState<string | null>(null);
  const [schemesExpanded, setSchemesExpanded] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewZoom, setReviewZoom] = useState(1);
  const [reviewFit, setReviewFit] = useState<'width' | 'real'>('width');
  const [reviewPos, setReviewPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // 真值标注
  const [gtModalOpen, setGtModalOpen] = useState(false);
  const [gtFields, setGtFields] = useState<Record<string, string>>({});
  const [savingGt, setSavingGt] = useState(false);
  const [manualSubjectModalOpen, setManualSubjectModalOpen] = useState(false);
  const [manualSubjectFields, setManualSubjectFields] = useState<Record<string, string>>({});

  const handleVerify = async () => {
    if (!id) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await verifyInvoice(parseInt(id));
      setVerifyResult(res);
      if (res.valid) {
        message.success(res.message);
      } else {
        message.error(res.message);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '校验失败');
    } finally {
      setVerifying(false);
    }
  };

  const handleOpenGtModal = () => {
    // Pre-fill with current confirmed values
    const defaults: Record<string, string> = {};
    for (const field of Object.keys(fieldLabels)) {
      const val = invoice ? String((invoice as any)[field] ?? '') : '';
      defaults[field] = val;
    }
    // Override with existing ground truth if present
    if (invoice?.ground_truth) {
      for (const [k, v] of Object.entries(invoice.ground_truth)) {
        defaults[k] = String(v ?? '');
      }
    }
    setGtFields(defaults);
    setGtModalOpen(true);
  };

  const handleSaveGt = async () => {
    if (!id) return;
    setSavingGt(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(gtFields)) {
        const trimmed = v.trim();
        if (trimmed) cleaned[k] = trimmed;
      }
      await saveGroundTruth(parseInt(id), cleaned);
      message.success('真值已保存');
      setGtModalOpen(false);
      fetchInvoice();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存真值失败');
    } finally {
      setSavingGt(false);
    }
  };

  const fetchInvoice = async () => {
    if (!id) return;

    setLoading(true);
    try {
      const data = await getInvoice(parseInt(id));
      setInvoice(data);
      // 将 items 赋予 form，如果为 null 则默认为空数组
      form.setFieldsValue({
        ...data,
        items: data.items || [],
      });
    } catch (error) {
      message.error('获取发票详情失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoice();
  }, [id]);

  const handleResolveDiff = async (diffId: number, source: 'ocr' | 'llm' | 'custom', customVal?: string) => {
    if (!id) return;
    setResolvingDiff(diffId);
    try {
      const result = await resolveDiff(parseInt(id), diffId, source, customVal);
      message.success(`${fieldLabels[result.field_name] || result.field_name} 已解决`);
      if (result.all_resolved) {
        message.success('所有差异已解决，请点击右上角确认发票！');
      }
      fetchInvoice();
    } catch (error) {
      message.error('解决差异失败');
    } finally {
      setResolvingDiff(null);
    }
  };

  const handleConfirmAll = async () => {
    if (!id || !invoice) return;

    if (subjectReview && !subjectApplied) {
      message.warning('请先在上方“主体信息复核”中确认买方/卖方信息，再提交整票确认。');
      return;
    }

    // 计算哪些字段被用户修改过（对比当前 form 值和 invoice 原始值）
    const corrections: Record<string, string> = {};
    const states = invoice.field_states || {};
    const formValues = form.getFieldsValue();

    for (const field of Object.keys(fieldLabels)) {
      const state = states[field];
      if (!state || state.status === 'locked') continue; // 锁定字段不可改

      const original = String(state.ocr ?? state.llm ?? '');
      const current = String(formValues[field] ?? '');
      if (current !== original && current.trim() !== '') {
        corrections[field] = current;
      }
    }

    try {
      const res = await confirmInvoice(parseInt(id), corrections);
      const label = res.next_status_label ? ` -> ${res.next_status_label}` : '';
      if (res.confirmation_mode === 'USER_EDIT' || res.confirmation_mode === 'USER_SELECTION') {
        message.warning(`${res.message}${label}`);
      } else {
        message.success(`${res.message}${label}`);
      }
      fetchInvoice();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { data?: { detail?: string } } };
        if (axiosError.response?.data?.detail) {
          message.error(axiosError.response.data.detail);
          return;
        }
      }
      message.error('确认失败');
    }
  };

  const handleReprocess = async () => {
    if (!id) return;
    setReprocessing(true);
    try {
      await reprocessInvoice(parseInt(id));
      message.success('重新解析完成');
      await fetchInvoice();
    } catch (error) {
      message.error('重新解析失败');
    } finally {
      setReprocessing(false);
    }
  };

  const handleCustomValueSubmit = async () => {
    if (customValueModal.diffId) {
      await handleResolveDiff(customValueModal.diffId, 'custom', customValue);
      setCustomValueModal({ visible: false, diffId: null, fieldName: '' });
      setCustomValue('');
    }
  };

  const applySubjectScheme = async (scheme: SubjectReviewScheme | null) => {
    if (!id || !scheme) return;
    setSubjectApplying(scheme.key);
    try {
      const res: SubjectReviewApplyResponse = await applySubjectReview(parseInt(id, 10), { scheme_key: scheme.key });
      message.success(res.message || `已应用：${scheme.display_label || scheme.label}`);
      await fetchInvoice();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '主体方案应用失败');
    } finally {
      setSubjectApplying(null);
    }
  };

  const openManualSubjectModal = () => {
    const initialFields: Record<string, string> = {};
    subjectFields.forEach((field) => {
      const current = (invoice as any)?.[field];
      const recommended = recommendedScheme?.fields?.[field];
      initialFields[field] = String(current ?? recommended ?? '');
    });
    setManualSubjectFields(initialFields);
    setManualSubjectModalOpen(true);
  };

  const applyManualSubject = async () => {
    if (!id) return;
    setSubjectApplying('manual');
    try {
      const payload: Record<string, string> = {};
      subjectFields.forEach((field) => {
        payload[field] = manualSubjectFields[field] ?? '';
      });
      const res: SubjectReviewApplyResponse = await applySubjectReview(parseInt(id, 10), { mode: 'manual', fields: payload });
      message.success(res.message || '主体信息已手动修正');
      setManualSubjectModalOpen(false);
      await fetchInvoice();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '手动修正提交失败');
    } finally {
      setSubjectApplying(null);
    }
  };

  const resetReviewViewport = () => {
    setReviewZoom(1);
    setReviewFit('width');
    setReviewPos({ x: 0, y: 0 });
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  if (!invoice) {
    return <div>发票不存在</div>;
  }

  const hasLlm = Boolean(invoice.llm_result);
  const hasDiffs = Boolean(invoice.parsing_diffs && invoice.parsing_diffs.length > 0);
  const hasUnresolvedDiffs = Boolean(invoice.parsing_diffs && invoice.parsing_diffs.some(d => !d.resolved));

  const subjectReview = (invoice.decision_trace?.subject_review || null) as SubjectReviewTrace | null;
  const subjectApplied = subjectReview?.applied === true;
  const subjectDiffs = (invoice.parsing_diffs || []).filter((diff) => subjectFields.includes(diff.field_name as typeof subjectFields[number]));
  const subjectNeedsManualReview = Boolean(subjectReview?.manual_review_required);
  const recommendedScheme = findSubjectScheme(subjectReview, subjectReview?.recommended_scheme_key);
  const nonSubjectDiffs = invoice.parsing_diffs?.filter((diff) => !subjectFields.includes(diff.field_name as typeof subjectFields[number])) || [];
  const nonSubjectPending = nonSubjectDiffs.filter((diff) => !diff.resolved).length;

  const matchCount = invoice.parsing_diffs?.filter(d => d.resolved).length || 0;
  const totalCount = invoice.parsing_diffs?.length || 0;

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <button className={styles.backButton} onClick={() => navigate('/invoices')}>
            <ArrowLeftOutlined />
            返回列表
          </button>
          <div className={styles.headerTitle}>
            <div className={styles.invoiceNumber}>
              {invoice.invoice_number || '发票详情'}
            </div>
            <div className={styles.invoiceMetadata}>
              开票日期: {invoice.issue_date || '-'} • 归属: {invoice.owner || '-'}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.rejectButton} disabled title="功能开发中">
            拒绝
          </button>
          <button
            className={styles.confirmButton}
            onClick={handleConfirmAll}
            disabled={invoice.status === '已确认' || invoice.status === '已报销' || invoice.status === '待重审' || invoice.status === '待随单审核' || Boolean(subjectReview && !subjectApplied)}
            style={{
              opacity: (invoice.status === '已确认' || invoice.status === '已报销' || invoice.status === '待重审' || invoice.status === '待随单审核' || Boolean(subjectReview && !subjectApplied)) ? 0.5 : 1,
              cursor: (invoice.status === '已确认' || invoice.status === '已报销' || invoice.status === '待重审' || invoice.status === '待随单审核' || Boolean(subjectReview && !subjectApplied)) ? 'not-allowed' : 'pointer'
            }}
          >
            {invoice.status === '已确认' ? '已确认'
              : invoice.status === '待重审' ? '待管理员复核'
              : invoice.status === '待随单审核' ? '待随单审核'
              : invoice.status === '已报销' ? '已报销'
              : Boolean(subjectReview && !subjectApplied) ? '请先完成主体信息复核'
              : '提交确认'}
          </button>
          <button
            className={styles.confirmButton}
            onClick={handleOpenGtModal}
            style={{ background: '#1677ff' }}
          >
            {invoice.ground_truth ? '已标注真值' : '设为真值'}
          </button>
        </div>
      </div>

      <div className={styles.contentBody}>
        <div className={styles.leftPanel}>
          {subjectReview && subjectDiffs.length > 0 && (
            <div className={styles.subjectReviewCard}>
              <div className={styles.subjectReviewHeader}>
                <div>
                  <div className={styles.subjectReviewTitle}>主体信息复核（买方/卖方）</div>
                  <div className={styles.subjectReviewSubtitle}>
                    {subjectReview.action_hint || '请对照原票确认主体信息，主体字段会在这里统一处理，下方表格继续处理其他字段。'}
                  </div>
                </div>
                {getSubjectRiskTag(subjectReview.risk_level)}
              </div>

              <div className={styles.subjectReviewBody}>
                {subjectReview.primary_message && (
                  <Alert
                    type={subjectNeedsManualReview ? 'warning' : 'info'}
                    showIcon
                    message={subjectReview.primary_message}
                  />
                )}

                <div className={styles.subjectReviewSummary}>
                  <div className={styles.subjectSummaryItem}>
                    <span>推荐方案</span>
                    <strong>{recommendedScheme?.display_label || subjectReview.recommended_scheme_label || '系统推荐'}</strong>
                  </div>
                  <div className={styles.subjectSummaryItem}>
                    <span>推荐得分</span>
                    <strong>{(subjectReview.recommended_score * 100).toFixed(0)}%</strong>
                  </div>
                  <div className={styles.subjectSummaryItem}>
                    <span>方案分差</span>
                    <strong>{(subjectReview.score_gap * 100).toFixed(0)}%</strong>
                  </div>
                </div>

                {subjectReview.risk_reasons && subjectReview.risk_reasons.length > 0 && (
                  <div className={styles.subjectRiskList}>
                    {subjectReview.risk_reasons.map((reason, index) => (
                      <div key={`${reason}-${index}`} className={styles.subjectRiskItem}>
                        <WarningOutlined />
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                )}

                {recommendedScheme && (
                  <div className={styles.subjectSchemePreview}>
                    {subjectFields.map((field) => (
                      <div key={field} className={styles.subjectPreviewCell}>
                        <span>{fieldLabels[field]}</span>
                        <strong>{recommendedScheme.fields[field] || '-'}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.subjectActionRow}>
                  <Button
                    type="primary"
                    loading={subjectApplying === (recommendedScheme?.key || 'recommended')}
                    onClick={() => applySubjectScheme(recommendedScheme)}
                  >
                    采纳建议并继续
                  </Button>
                  <Button onClick={openManualSubjectModal}>
                    手动修正主体信息
                  </Button>
                  <Button
                    icon={<ExpandOutlined />}
                    onClick={() => {
                      resetReviewViewport();
                      setReviewModalOpen(true);
                    }}
                  >
                    查看原票（放大）
                  </Button>
                  <Button
                    type="link"
                    icon={schemesExpanded ? <UpOutlined /> : <DownOutlined />}
                    onClick={() => setSchemesExpanded((prev) => !prev)}
                  >
                    {schemesExpanded ? '收起备选方案' : '查看备选方案（高级）'}
                  </Button>
                </div>

                <div className={styles.subjectHint}>
                  {subjectApplied
                    ? '主体信息已确认，下方表格中的主体字段只显示结果，其他字段仍需继续确认。'
                    : '先在这里确认买方/卖方主体，再去下方继续处理非主体字段。'}
                </div>

                {schemesExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {subjectReview.candidate_schemes?.map((scheme) => {
                      const isRecommended = scheme.key === subjectReview.recommended_scheme_key;
                      return (
                        <Card
                          key={scheme.key}
                          size="small"
                          style={{ borderColor: isRecommended ? '#1677ff' : undefined }}
                          title={
                            <Space>
                              <span>{scheme.display_label || scheme.label}</span>
                              {isRecommended && <Tag color="blue">推荐</Tag>}
                            </Space>
                          }
                          extra={
                            <Space size="small">
                              <span style={{ fontSize: 12, color: '#888' }}>可信度 {(scheme.score * 100).toFixed(0)}%</span>
                              {!isRecommended && (
                                <span style={{ fontSize: 12, color: '#d48806' }}>
                                  与推荐差距 {((subjectReview.recommended_score - scheme.score) * 100).toFixed(0)}%
                                </span>
                              )}
                            </Space>
                          }
                        >
                          <div className={styles.subjectSchemePreview}>
                            {subjectFields.map((field) => (
                              <div key={`${scheme.key}-${field}`} className={styles.subjectPreviewCell}>
                                <span>{fieldLabels[field]}</span>
                                <strong>{scheme.fields[field] || '-'}</strong>
                              </div>
                            ))}
                          </div>
                          {!isRecommended && (
                            <div style={{ marginTop: 12 }}>
                              <Button
                                type="link"
                                loading={subjectApplying === scheme.key}
                                onClick={() => applySubjectScheme(scheme)}
                              >
                                采用此方案
                              </Button>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                发票信息
                <StatusTag status={invoice.status === '已确认' ? 'success' : 'processing'}>
                  {invoice.status}
                </StatusTag>
              </div>
              <div className={styles.cardActions}>
                {editMode ? (
                  <Button onClick={() => setEditMode(false)}>取消核对</Button>
                ) : invoice.status !== '已确认' && invoice.status !== '已报销' ? (
                  <Button type="primary" icon={<EditOutlined />} onClick={() => setEditMode(true)}>
                    核对确认
                  </Button>
                ) : null}
              </div>
            </div>
            <div className={styles.cardBody}>
              {editMode ? (
                <Form form={form} layout="vertical">
                  <div style={{ marginBottom: 16, padding: '8px 14px', borderRadius: 8, background: '#f0f5ff', border: '1px solid #d6e4ff', fontSize: 13, color: '#1d39c4' }}>
                    请对照左侧原始发票图像逐字段核实，<b>锁定字段不可修改</b>，可编辑字段修改后将被标记为<b>"用户修正"</b>并转管理员复核。
                  </div>
                  {/* --- 发票主表字段 --- */}
                  <Row gutter={16}>
                    {Object.keys(fieldLabels).map((field) => {
                      const state = invoice.field_states?.[field];
                      const isLocked = state?.status === 'locked';
                      const isConflict = state?.status === 'conflict';
                      const confidence = state?.confidence != null ? `${(state.confidence * 100).toFixed(0)}%` : null;

                      let badge: React.ReactNode = null;
                      let fieldBg: React.CSSProperties = {};
                      if (isLocked) {
                        badge = <Tooltip title={`双引擎一致 · 置信度 ${confidence}`}><CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 4 }} /></Tooltip>;
                        fieldBg = { background: '#f6ffed', borderColor: '#b7eb8f' };
                      } else if (isConflict) {
                        badge = <Tooltip title={`OCR: ${state?.ocr ?? '-'} | LLM: ${state?.llm ?? '-'}`}><WarningOutlined style={{ color: '#ff4d4f', marginLeft: 4 }} /></Tooltip>;
                        fieldBg = { background: '#fff2f0', borderColor: '#ffccc7' };
                      } else {
                        badge = <Tooltip title={`可修正 · 置信度 ${confidence}`}><EditOutlined style={{ color: '#faad14', marginLeft: 4 }} /></Tooltip>;
                      }

                      return (
                        <Col span={8} key={field}>
                          <Form.Item
                            name={field}
                            label={<span>{fieldLabels[field]} {badge}</span>}
                          >
                            <Input
                              disabled={isLocked || isConflict}
                              style={fieldBg}
                              placeholder={isConflict ? `OCR:${state?.ocr} | LLM:${state?.llm}` : undefined}
                            />
                          </Form.Item>
                        </Col>
                      );
                    })}
                  </Row>

                  {/* --- 商品明细 --- */}
                  <div style={{ marginTop: 24, marginBottom: 16, fontWeight: 'bold' }}>商品明细</div>
                  <Form.List name="items">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...restField }) => (
                          <Card size="small" key={key} style={{ marginBottom: 16, background: '#fafafa' }} extra={
                            <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                          }>
                            <Row gutter={16}>
                              <Col span={8}><Form.Item {...restField} name={[name, 'item_name']} label="项目名称"><Input /></Form.Item></Col>
                              <Col span={6}><Form.Item {...restField} name={[name, 'specification']} label="规格型号"><Input /></Form.Item></Col>
                              <Col span={5}><Form.Item {...restField} name={[name, 'amount']} label="金额"><Input /></Form.Item></Col>
                              <Col span={5}><Form.Item {...restField} name={[name, 'tax_amount']} label="税额"><Input /></Form.Item></Col>
                            </Row>
                          </Card>
                        ))}
                        <Form.Item>
                          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>添加一行明细</Button>
                        </Form.Item>
                      </>
                    )}
                  </Form.List>
                </Form>
              ) : (
                <>
                  {/* --- 1. 展示模式的全局字段 --- */}
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="发票号码">{invoice.invoice_number || '-'}</Descriptions.Item>
                    <Descriptions.Item label="开票日期">{invoice.issue_date || '-'}</Descriptions.Item>
                    <Descriptions.Item label="购买方名称">{invoice.buyer_name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="购买方纳税号">{invoice.buyer_tax_id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="销售方名称">{invoice.seller_name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="销售方纳税号">{invoice.seller_tax_id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="总金额(不含税)">{invoice.amount || '-'}</Descriptions.Item>
                    <Descriptions.Item label="总税额">{invoice.tax_amount || '-'}</Descriptions.Item>
                    <Descriptions.Item label="价税合计" span={2}>
                      <span style={{ color: '#cf1322', fontWeight: 'bold' }}>
                        {invoice.total_with_tax != null ? `¥${Number(invoice.total_with_tax).toFixed(2)}` : '-'}
                      </span>
                    </Descriptions.Item>
                    {invoice.spend_category && (
                      <Descriptions.Item label="🌿 消费类别">{invoice.spend_category}</Descriptions.Item>
                    )}
                    {invoice.carbon_kg != null && (
                      <Descriptions.Item label="🌿 碳足迹" span={invoice.spend_category ? 1 : 2}>
                        <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                          {Number(invoice.carbon_kg).toFixed(4)} kg CO₂
                        </span>
                      </Descriptions.Item>
                    )}
                    {invoice.invoice_hash && (
                      <Descriptions.Item label={<span><SafetyCertificateOutlined style={{ marginRight: 4, color: '#1677ff' }} />数字指纹</span>} span={2}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <code style={{
                            fontSize: 11,
                            background: '#f5f5f5',
                            padding: '2px 8px',
                            borderRadius: 4,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {invoice.invoice_hash}
                          </code>
                          <Button
                            size="small"
                            type="link"
                            icon={<SafetyCertificateOutlined />}
                            onClick={handleVerify}
                            loading={verifying}
                          >
                            验证
                          </Button>
                        </div>
                        {verifyResult && (
                          <div style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: verifyResult.valid ? '#389e0d' : '#cf1322',
                          }}>
                            {verifyResult.valid ? (
                              <span><CheckCircleOutlined style={{ marginRight: 4 }} />数字指纹校验通过，数据完整可信</span>
                            ) : (
                              <span><CloseCircleOutlined style={{ marginRight: 4 }} />警告：数据已被篡改</span>
                            )}
                          </div>
                        )}
                      </Descriptions.Item>
                    )}
                  </Descriptions>

                  {/* --- 2. 展示模式：大模型直接提取出的明细表格 --- */}
                  <div style={{ marginTop: 24 }}>
                    <div style={{ marginBottom: 16, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      商品明细 <span style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>*完全由大模型智能识别提取</span>
                    </div>
                    {/* 🚨 这里使用了完美的占位符和严谨的条件判断，再也不会报 TS6133 和 TS18048 了 */}
                    <Table
                      dataSource={invoice.items || []}
                      columns={itemColumns}
                      pagination={false}
                      size="small"
                      bordered
                      rowKey={(_, index) => index !== undefined ? String(index) : Math.random().toString()}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                解析结果比对
                {!hasLlm && (
                  <StatusTag status="processing">
                    OCR-only
                  </StatusTag>
                )}
                {hasLlm && hasUnresolvedDiffs && (
                  <StatusTag status="warning">
                    {subjectReview && !subjectApplied
                      ? `主体信息待确认 1 组，其他字段待确认 ${nonSubjectPending} 项`
                      : `${totalCount - matchCount}/${totalCount} 待确认`}
                  </StatusTag>
                )}
                {hasLlm && hasDiffs && !hasUnresolvedDiffs && (
                  <StatusTag status="success">
                    已完成比对
                  </StatusTag>
                )}
              </div>
              <div className={styles.cardActions}>
                <Button
                  icon={<SyncOutlined spin={reprocessing} />}
                  onClick={handleReprocess}
                  loading={reprocessing}
                  size="small"
                >
                  重新解析
                </Button>
              </div>
            </div>

            <Spin spinning={reprocessing} tip="正在重新解析...">
              {hasLlm && hasDiffs && (
                <div className={styles.comparisonHeader}>
                  <span className={styles.matchStatus}>
                    {matchCount}/{totalCount} 字段匹配 (发票主干信息)
                  </span>
                </div>
              )}

              <div className={styles.cardBody}>
              {!hasLlm && (
                <div className={styles.infoAlert}>
                  发票已通过OCR识别预处理，可直接编辑后确认。配置LLM服务可获得更精准的智能比对功能，点击"重新解析"启用双重校验。
                </div>
              )}
              {hasDiffs ? (
                <table className={styles.comparisonTable}>
                  <thead>
                    <tr>
                      <th style={{ width: '16%' }}>字段</th>
                      <th style={{ width: '24%' }}>OCR识别结果</th>
                      <th style={{ width: '24%' }}>LLM解析结果</th>
                      <th style={{ width: '14%' }}>置信度</th>
                      <th style={{ width: '22%' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.parsing_diffs?.map((diff) => {
                      const isMatch = diff.ocr_value === diff.llm_value;
                      const isLowConf = diff.confidence != null && diff.confidence < 0.8;
                      const isSubjectField = subjectFields.includes(diff.field_name as typeof subjectFields[number]);
                      return (
                        <tr
                          key={diff.id}
                          className={!isMatch ? styles.mismatch : styles.match}
                          style={isLowConf ? { background: '#fffbe6' } : undefined}
                        >
                          <td className={styles.fieldCell}>
                            {fieldLabels[diff.field_name] || diff.field_name}
                            {isLowConf && (
                              <Tooltip title={
                                <div>
                                  综合置信度偏低，建议核对原图<br />
                                  OCR: {diff.ocr_confidence != null ? `${(diff.ocr_confidence * 100).toFixed(0)}%` : 'N/A'} | LLM: {diff.llm_confidence != null ? `${(diff.llm_confidence * 100).toFixed(0)}%` : 'N/A'}
                                </div>
                              }>
                                <WarningOutlined style={{ color: '#faad14', marginLeft: 4 }} />
                              </Tooltip>
                            )}
                          </td>
                          <td>
                            <div className={styles.valueCell}>
                              {!isMatch && <CloseCircleOutlined className={`${styles.statusIcon} ${styles.mismatch}`} />}
                              {isMatch && <CheckCircleOutlined className={`${styles.statusIcon} ${styles.match}`} />}
                              <span>{diff.ocr_value || '-'}</span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.valueCell}>
                              {!isMatch && <CloseCircleOutlined className={`${styles.statusIcon} ${styles.mismatch}`} />}
                              {isMatch && <CheckCircleOutlined className={`${styles.statusIcon} ${styles.match}`} />}
                              <span>{diff.llm_value || '-'}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {diff.confidence != null ? (
                              <Tooltip
                                title={
                                  <div style={{ lineHeight: 1.8 }}>
                                    <div>OCR: {diff.ocr_confidence != null ? `${(diff.ocr_confidence * 100).toFixed(0)}%` : 'N/A'}</div>
                                    <div>LLM: {diff.llm_confidence != null ? `${(diff.llm_confidence * 100).toFixed(0)}%` : 'N/A'}</div>
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', marginTop: 4, paddingTop: 4 }}>
                                      综合: {(diff.confidence * 100).toFixed(0)}% {diff.ocr_value && diff.llm_value && diff.ocr_value !== diff.llm_value ? '(冲突-0.15)' : ''}
                                    </div>
                                  </div>
                                }
                              >
                                <span style={{
                                  color: diff.confidence < 0.8 ? '#d48806' : '#389e0d',
                                  fontWeight: 'bold',
                                  fontSize: 14,
                                  cursor: 'help',
                                  borderBottom: '1px dashed currentColor',
                                }}>
                                  {(diff.confidence * 100).toFixed(0)}%
                                </span>
                              </Tooltip>
                            ) : (
                              <span style={{ color: '#ccc' }}>-</span>
                            )}
                          </td>
                          <td>
                            {isSubjectField ? (
                              subjectApplied ? (
                                <StatusTag status="success">
                                  已由主体信息复核确认{subjectReview?.applied_scheme_display_label ? `（${subjectReview.applied_scheme_display_label}）` : ''}
                                </StatusTag>
                              ) : (
                                <span style={{ color: '#d48806', fontSize: 12 }}>请先在上方主体信息复核中确认</span>
                              )
                            ) : !diff.resolved && !isMatch ? (
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <Button
                                  type="link"
                                  size="small"
                                  loading={resolvingDiff === diff.id}
                                  onClick={() => handleResolveDiff(diff.id, 'ocr')}
                                >
                                  选OCR
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  loading={resolvingDiff === diff.id}
                                  onClick={() => handleResolveDiff(diff.id, 'llm')}
                                >
                                  选LLM
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  onClick={() => {
                                    setCustomValueModal({ visible: true, diffId: diff.id, fieldName: diff.field_name });
                                    setCustomValue(diff.ocr_value || diff.llm_value || '');
                                  }}
                                >
                                  自定义
                                </Button>
                              </div>
                            ) : diff.resolved ? (
                              <StatusTag status="success">已解决</StatusTag>
                            ) : isMatch && !diff.resolved ? (
                              <Button
                                type="link"
                                size="small"
                                onClick={() => handleResolveDiff(diff.id, 'ocr')}
                              >
                                确认
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                  {hasLlm ? '无比对差异' : 'OCR-only 模式暂无比对数据'}
                </div>
              )}
            </div>
            </Spin>
          </div>

          {/* 🔍 图像取证分析面板 */}
          {invoice.forensics_result && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  <BugOutlined style={{ marginRight: 8 }} />
                  图像取证分析
                  {invoice.forensics_result.risk_level === 'high' && (
                    <StatusTag status="error">高风险</StatusTag>
                  )}
                  {invoice.forensics_result.risk_level === 'medium' && (
                    <StatusTag status="warning">中风险</StatusTag>
                  )}
                  {invoice.forensics_result.risk_level === 'low' && (
                    <StatusTag status="success">低风险</StatusTag>
                  )}
                  {invoice.forensics_result.risk_level === 'unknown' && (
                    <span style={{
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: '#f5f5f5',
                      color: '#999',
                    }}>未知</span>
                  )}
                </div>
              </div>
              <div className={styles.cardBody}>
                {/* 风险评分条 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>综合风险评分</span>
                    <span style={{
                      fontWeight: 'bold',
                      color: invoice.forensics_result.risk_score >= 70 ? '#cf1322'
                           : invoice.forensics_result.risk_score >= 40 ? '#d48806'
                           : '#389e0d',
                      fontSize: 18,
                    }}>
                      {invoice.forensics_result.risk_score}/100
                    </span>
                  </div>
                  <div style={{
                    height: 10,
                    borderRadius: 5,
                    background: '#f0f0f0',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, invoice.forensics_result.risk_score)}%`,
                      borderRadius: 5,
                      background: invoice.forensics_result.risk_score >= 70
                        ? 'linear-gradient(90deg, #ff4d4f, #ff7a45)'
                        : invoice.forensics_result.risk_score >= 40
                        ? 'linear-gradient(90deg, #faad14, #ffc53d)'
                        : 'linear-gradient(90deg, #52c41a, #73d13d)',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>

                {/* 摘要 */}
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 6,
                  background: invoice.forensics_result.risk_level === 'high' ? '#fff2f0'
                           : invoice.forensics_result.risk_level === 'medium' ? '#fffbe6'
                           : '#f6ffed',
                  border: `1px solid ${invoice.forensics_result.risk_level === 'high' ? '#ffccc7'
                           : invoice.forensics_result.risk_level === 'medium' ? '#ffe58f'
                           : '#b7eb8f'}`,
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  <SafetyCertificateOutlined style={{ marginRight: 6, color: invoice.forensics_result.risk_level === 'high' ? '#cf1322' : invoice.forensics_result.risk_level === 'medium' ? '#d48806' : '#389e0d' }} />
                  {invoice.forensics_result.summary || '暂无摘要'}
                </div>

                {/* 详细发现列表 */}
                {invoice.forensics_result.details && invoice.forensics_result.details.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                      <FundOutlined style={{ marginRight: 4 }} />
                      检测发现 ({invoice.forensics_result.details.length} 条)
                    </div>
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {invoice.forensics_result.details.map((d, i) => (
                        <div key={i} style={{
                          padding: '6px 10px',
                          marginBottom: 4,
                          borderRadius: 4,
                          background: '#fafafa',
                          fontSize: 12,
                          lineHeight: 1.5,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                        }}>
                          <span style={{ color: '#faad14', flexShrink: 0 }}>●</span>
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 各检测器得分概要 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <ForensicsDetectorBadge
                    icon={<FileImageOutlined />}
                    name="元数据"
                    suspicious={invoice.forensics_result.metadata_result?.suspicious}
                    findings={invoice.forensics_result.metadata_result?.findings}
                  />
                  <ForensicsDetectorBadge
                    icon={<EyeOutlined />}
                    name="ELA 误差分析"
                    suspicious={invoice.forensics_result.ela_result?.suspicious}
                    findings={invoice.forensics_result.ela_result?.findings}
                  />
                  <ForensicsDetectorBadge
                    icon={<SoundOutlined />}
                    name="JPEG 双重压缩"
                    suspicious={invoice.forensics_result.jpeg_double_compression_result?.suspicious}
                    findings={invoice.forensics_result.jpeg_double_compression_result?.findings}
                  />
                  <ForensicsDetectorBadge
                    icon={<FundOutlined />}
                    name="噪声一致性"
                    suspicious={invoice.forensics_result.noise_consistency_result?.suspicious}
                    findings={invoice.forensics_result.noise_consistency_result?.findings}
                  />
                </div>
              </div>
            </div>
          )}

          <Modal
            title="放大核对原票"
            open={reviewModalOpen}
            onCancel={() => {
              setReviewModalOpen(false);
              setIsDragging(false);
            }}
            footer={null}
            width="92vw"
            style={{ top: 24 }}
          >
            <div style={{ display: 'flex', gap: 16, height: '78vh' }}>
              <div style={{ flex: 1, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space wrap>
                    <Button icon={<ZoomOutOutlined />} onClick={() => setReviewZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}>缩小</Button>
                    <Button icon={<ZoomInOutlined />} onClick={() => setReviewZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))}>放大</Button>
                    <Button icon={<ColumnWidthOutlined />} onClick={() => { setReviewFit('width'); setReviewZoom(1); setReviewPos({ x: 0, y: 0 }); }}>适配宽度</Button>
                    <Button icon={<ExpandOutlined />} onClick={() => { setReviewFit('real'); setReviewZoom(1); setReviewPos({ x: 0, y: 0 }); }}>1:1</Button>
                  </Space>
                  <span style={{ fontSize: 12, color: '#999' }}>拖拽图片可平移查看</span>
                </div>
                <div
                  style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab' }}
                  onMouseMove={(event) => {
                    if (!isDragging) return;
                    setReviewPos((prev) => ({
                      x: prev.x + event.clientX - dragStart.x,
                      y: prev.y + event.clientY - dragStart.y,
                    }));
                    setDragStart({ x: event.clientX, y: event.clientY });
                  }}
                  onMouseUp={() => setIsDragging(false)}
                  onMouseLeave={() => setIsDragging(false)}
                >
                  {invoice.file_type === 'pdf' ? (
                    <iframe
                      src={getInvoiceFileUrl(invoice.id)}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      title="PDF Review"
                    />
                  ) : (
                    <img
                      src={getInvoiceFileUrl(invoice.id)}
                      alt="Invoice Review"
                      onMouseDown={(event) => {
                        setIsDragging(true);
                        setDragStart({ x: event.clientX, y: event.clientY });
                      }}
                      style={{
                        width: reviewFit === 'width' ? `${reviewZoom * 100}%` : 'auto',
                        maxWidth: reviewFit === 'width' ? 'none' : 'unset',
                        height: 'auto',
                        transform: `translate(${reviewPos.x}px, ${reviewPos.y}px) scale(${reviewFit === 'real' ? reviewZoom : 1})`,
                        transformOrigin: 'top left',
                        userSelect: 'none',
                        display: 'block',
                      }}
                    />
                  )}
                </div>
              </div>

              <div style={{ width: 320, border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, overflow: 'auto' }}>
                <h4 style={{ marginTop: 0 }}>当前主体信息</h4>
                <div style={{ marginBottom: 12, fontSize: 12, color: '#999' }}>
                  来源：{recommendedScheme?.display_label || subjectReview?.recommended_scheme_label || '系统推荐'}
                </div>
                {subjectFields.map((field) => (
                  <div key={field} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{fieldLabels[field]}</div>
                    <div style={{ fontWeight: 600 }}>{recommendedScheme?.fields[field] || (invoice as any)[field] || '-'}</div>
                  </div>
                ))}
                <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
                  <Button type="primary" block loading={subjectApplying === (recommendedScheme?.key || 'recommended')} onClick={() => applySubjectScheme(recommendedScheme)}>
                    采纳建议并继续
                  </Button>
                  <Button block onClick={openManualSubjectModal}>手动修正主体信息</Button>
                </Space>
              </div>
            </div>
          </Modal>

          <Modal
            title="手动修正主体信息"
            open={manualSubjectModalOpen}
            onOk={applyManualSubject}
            confirmLoading={subjectApplying === 'manual'}
            onCancel={() => setManualSubjectModalOpen(false)}
            okText="提交主体修正"
            cancelText="取消"
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              {subjectFields.map((field) => (
                <div key={field}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{fieldLabels[field]}</div>
                  <Input
                    value={manualSubjectFields[field] || ''}
                    onChange={(event) => setManualSubjectFields((prev) => ({ ...prev, [field]: event.target.value }))}
                    placeholder={`请输入${fieldLabels[field]}`}
                  />
                </div>
              ))}
            </div>
          </Modal>

          <Modal
            title={`自定义值 - ${fieldLabels[customValueModal.fieldName] || customValueModal.fieldName}`}
            open={customValueModal.visible}
            onOk={handleCustomValueSubmit}
            onCancel={() => {
              setCustomValueModal({ visible: false, diffId: null, fieldName: '' });
              setCustomValue('');
            }}
            okText="确定"
            cancelText="取消"
          >
            <Input
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="请输入自定义值"
            />
          </Modal>

          {/* 真值标注 Modal */}
          <Modal
            title="人工标注真值 (Ground Truth)"
            open={gtModalOpen}
            onOk={handleSaveGt}
            onCancel={() => setGtModalOpen(false)}
            okText="保存真值"
            cancelText="取消"
            confirmLoading={savingGt}
            width={600}
          >
            <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
              请根据原始发票图片逐字段核对并修正，填入的值将被视为正确答案用于精度评估。
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              {Object.keys(fieldLabels).map((field) => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, minWidth: 90, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fieldLabels[field]}
                  </span>
                  <Input
                    size="small"
                    value={gtFields[field] || ''}
                    onChange={(e) => setGtFields({ ...gtFields, [field]: e.target.value })}
                    style={{ flex: 1 }}
                  />
                </div>
              ))}
            </div>
          </Modal>
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <span className={styles.previewTitle}>原始文件</span>
              <div className={styles.previewControls}>
                <button
                  type="button"
                  className={styles.downloadButton}
                  onClick={() => {
                    resetReviewViewport();
                    setReviewModalOpen(true);
                  }}
                >
                  <ExpandOutlined />
                  放大核对
                </button>
                <a
                  href={getInvoiceFileUrl(invoice.id)}
                  download
                  className={styles.downloadButton}
                >
                  <DownloadOutlined />
                  下载
                </a>
              </div>
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewContent}>
                {invoice.file_type === 'pdf' ? (
                  <iframe
                    src={getInvoiceFileUrl(invoice.id)}
                    style={{ width: '100%', height: 600, border: 'none' }}
                    title="PDF Preview"
                  />
                ) : (
                  <img
                    src={getInvoiceFileUrl(invoice.id)}
                    alt="Invoice"
                    style={{ width: '100%', maxHeight: 600, objectFit: 'contain' }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InvoiceDetailPage;
