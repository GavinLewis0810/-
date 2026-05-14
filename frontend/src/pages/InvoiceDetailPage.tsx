import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
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
  Select,
  Modal,
  Table,
  Card,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
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
} from '@ant-design/icons';
import { getInvoice, getInvoiceFileUrl, updateInvoice, resolveDiff, confirmInvoice, reprocessInvoice, verifyInvoice, saveGroundTruth } from '../services/api';
import type { InvoiceDetail } from '../types/invoice';
import { InvoiceStatus } from '../types/invoice';
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

const CONFIDENCE_THRESHOLD = 0.8;

function buildConfidenceMap(diffs: { field_name: string; confidence: number | null }[]): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  for (const d of diffs) {
    map[d.field_name] = d.confidence;
  }
  return map;
}

function getConfidenceStyle(confidence: number | null | undefined): CSSProperties {
  if (confidence == null) return {};
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { background: '#fffbe6', borderColor: '#faad14' };
  }
  return { background: '#f6ffed', borderColor: '#52c41a' };
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

  // 真值标注
  const [gtModalOpen, setGtModalOpen] = useState(false);
  const [gtFields, setGtFields] = useState<Record<string, string>>({});
  const [savingGt, setSavingGt] = useState(false);

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

  const handleSave = async () => {
    if (!id || !invoice) return;

    try {
      const values = await form.validateFields();
      await updateInvoice(parseInt(id), values);
      message.success('保存成功');
      setEditMode(false);
      fetchInvoice();
    } catch (error) {
      message.error('保存失败');
    }
  };

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
    if (!id) return;

    if (invoice) {
      // 移除了对单行 item_name 的必填校验，因为现在是数组了
      const requiredFields: Array<keyof InvoiceDetail> = [
        'invoice_number',
        'issue_date',
        'total_with_tax',
        'buyer_name',
        'seller_name',
      ];
      const missing = requiredFields.filter((field) => {
        const value = invoice[field];
        if (value === null || value === undefined) {
          return true;
        }
        if (typeof value === 'string') {
          return value.trim().length === 0;
        }
        return false;
      });

      if (missing.length > 0) {
        message.error('请先补全基础必填字段，再进行确认。');
        return;
      }
    }

    try {
      await confirmInvoice(parseInt(id));
      message.success(invoice?.llm_result ? '发票已确认' : '发票已确认（OCR-only）');
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

  const matchCount = invoice.parsing_diffs?.filter(d => d.resolved).length || 0;
  const totalCount = invoice.parsing_diffs?.length || 0;

  // HITL: 构建字段置信度映射，用于高亮低置信度字段
  const confidenceMap = buildConfidenceMap(invoice.parsing_diffs || []);

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
            disabled={invoice.status === '已确认' || (hasLlm && hasUnresolvedDiffs)}
            style={{
              opacity: (invoice.status === '已确认' || (hasLlm && hasUnresolvedDiffs)) ? 0.5 : 1,
              cursor: (invoice.status === '已确认' || (hasLlm && hasUnresolvedDiffs)) ? 'not-allowed' : 'pointer'
            }}
          >
            {invoice.status === '已确认' ? '已确认' : '确认发票'}
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
                  <>
                    <Button onClick={() => setEditMode(false)}>取消</Button>
                    <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                      保存
                    </Button>
                  </>
                ) : (
                  <Button icon={<EditOutlined />} onClick={() => setEditMode(true)}>
                    编辑
                  </Button>
                )}
              </div>
            </div>
            <div className={styles.cardBody}>
              {editMode ? (
                <Form form={form} layout="vertical">
                  {/* --- 1. 发票主表字段（头部信息） --- */}
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="invoice_number" label={
                        <span>发票号码 {confidenceMap.invoice_number != null && confidenceMap.invoice_number < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.invoice_number! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.invoice_number)} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="issue_date" label={
                        <span>开票日期 {confidenceMap.issue_date != null && confidenceMap.issue_date < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.issue_date! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.issue_date)} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="total_with_tax" label={
                        <span>价税合计(总额) {confidenceMap.total_with_tax != null && confidenceMap.total_with_tax < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.total_with_tax! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input type="number" style={getConfidenceStyle(confidenceMap.total_with_tax)} /></Form.Item>
                    </Col>

                    <Col span={12}>
                      <Form.Item name="buyer_name" label={
                        <span>购买方名称 {confidenceMap.buyer_name != null && confidenceMap.buyer_name < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.buyer_name! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.buyer_name)} /></Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="buyer_tax_id" label={
                        <span>购买方纳税人识别号 {confidenceMap.buyer_tax_id != null && confidenceMap.buyer_tax_id < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.buyer_tax_id! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.buyer_tax_id)} /></Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="seller_name" label={
                        <span>销售方名称 {confidenceMap.seller_name != null && confidenceMap.seller_name < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.seller_name! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.seller_name)} /></Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="seller_tax_id" label={
                        <span>销售方纳税人识别号 {confidenceMap.seller_tax_id != null && confidenceMap.seller_tax_id < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.seller_tax_id! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input style={getConfidenceStyle(confidenceMap.seller_tax_id)} /></Form.Item>
                    </Col>

                    <Col span={8}>
                      <Form.Item name="amount" label={
                        <span>金额(不含税) {confidenceMap.amount != null && confidenceMap.amount < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.amount! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input type="number" style={getConfidenceStyle(confidenceMap.amount)} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="tax_amount" label={
                        <span>总税额 {confidenceMap.tax_amount != null && confidenceMap.tax_amount < CONFIDENCE_THRESHOLD && <Tooltip title={`LLM置信度 ${(confidenceMap.tax_amount! * 100).toFixed(0)}%，建议核对原图`}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>}</span>
                      }><Input type="number" style={getConfidenceStyle(confidenceMap.tax_amount)} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="status" label="状态">
                        <Select options={Object.values(InvoiceStatus).map((s) => ({ label: s, value: s }))} />
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* --- 2. 动态表单列表 (发票商品明细 items) --- */}
                  <div style={{ marginTop: 24, marginBottom: 16, fontWeight: 'bold' }}>商品明细编辑</div>
                  <Form.List name="items">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...restField }) => (
                          <Card size="small" key={key} style={{ marginBottom: 16, background: '#fafafa' }} extra={
                            <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                          }>
                            <Row gutter={16}>
                              <Col span={8}>
                                <Form.Item {...restField} name={[name, 'item_name']} label="项目名称">
                                  <Input placeholder="输入项目名称" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item {...restField} name={[name, 'specification']} label="规格型号">
                                  <Input placeholder="规格型号" />
                                </Form.Item>
                              </Col>
                              <Col span={5}>
                                <Form.Item {...restField} name={[name, 'amount']} label="金额(不含税)">
                                  <Input placeholder="金额" />
                                </Form.Item>
                              </Col>
                              <Col span={5}>
                                <Form.Item {...restField} name={[name, 'tax_amount']} label="税额">
                                  <Input placeholder="税额" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item {...restField} name={[name, 'quantity']} label="数量">
                                  <Input placeholder="数量" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item {...restField} name={[name, 'unit_price']} label="单价">
                                  <Input placeholder="单价" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item {...restField} name={[name, 'unit']} label="单位">
                                  <Input placeholder="单位" />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item {...restField} name={[name, 'tax_rate']} label="税率">
                                  <Input placeholder="税率" />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        ))}
                        <Form.Item>
                          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                            添加一行商品明细
                          </Button>
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
                    {totalCount - matchCount}/{totalCount} 待确认
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
                      const isLowConf = diff.confidence != null && diff.confidence < CONFIDENCE_THRESHOLD;
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
                                  color: diff.confidence < CONFIDENCE_THRESHOLD ? '#d48806' : '#389e0d',
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
                            {!diff.resolved && !isMatch && (
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
                            )}
                            {diff.resolved && (
                              <StatusTag status="success">已解决</StatusTag>
                            )}
                            {isMatch && !diff.resolved && (
                              <Button
                                type="link"
                                size="small"
                                onClick={() => handleResolveDiff(diff.id, 'ocr')}
                              >
                                确认
                              </Button>
                            )}
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
