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
  Select,
  Modal,
  Table,
  Card,
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
} from '@ant-design/icons';
import { getInvoice, getInvoiceFileUrl, updateInvoice, resolveDiff, confirmInvoice, reprocessInvoice } from '../services/api';
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

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <button className={styles.backButton} onClick={() => navigate('/')}>
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
                    <Col span={8}><Form.Item name="invoice_number" label="发票号码"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="issue_date" label="开票日期"><Input /></Form.Item></Col>
                    <Col span={8}><Form.Item name="total_with_tax" label="价税合计(总额)"><Input type="number" /></Form.Item></Col>

                    <Col span={12}><Form.Item name="buyer_name" label="购买方名称"><Input /></Form.Item></Col>
                    <Col span={12}><Form.Item name="buyer_tax_id" label="购买方纳税人识别号"><Input /></Form.Item></Col>
                    <Col span={12}><Form.Item name="seller_name" label="销售方名称"><Input /></Form.Item></Col>
                    <Col span={12}><Form.Item name="seller_tax_id" label="销售方纳税人识别号"><Input /></Form.Item></Col>

                    <Col span={8}><Form.Item name="amount" label="金额(不含税)"><Input type="number" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="tax_amount" label="总税额"><Input type="number" /></Form.Item></Col>
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
                      <th style={{ width: '20%' }}>字段</th>
                      <th style={{ width: '30%' }}>OCR识别结果</th>
                      <th style={{ width: '30%' }}>LLM解析结果</th>
                      <th style={{ width: '20%' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.parsing_diffs?.map((diff) => {
                      const isMatch = diff.ocr_value === diff.llm_value;
                      return (
                        <tr key={diff.id} className={!isMatch ? styles.mismatch : styles.match}>
                          <td className={styles.fieldCell}>
                            {fieldLabels[diff.field_name] || diff.field_name}
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
