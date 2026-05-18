import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Select,
  Input,
  message,
  Popconfirm,
  Modal,
  Statistic,
  Row,
  Col,
  Form,
} from 'antd';
import {
  EyeOutlined,
  DeleteOutlined,
  UploadOutlined,
  ReloadOutlined,
  DownloadOutlined,
  SyncOutlined,
  AuditOutlined,
  CheckOutlined,
  FileTextOutlined,
  DollarOutlined,
  PercentageOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  listInvoices, deleteInvoice, batchUpdateInvoices,
  batchDeleteInvoices, batchReprocessInvoices, getStatistics,
  createReimbursement, autoConfirmInvoices, getProjects, getBankCards, getApplications, getBorrowings,
  getReasonCategories, ReasonCategory, suggestCategory
} from '../services/api';
import type { Invoice, Statistics } from '../types/invoice';
import { InvoiceStatus } from '../types/invoice';
import ResizableTitle from '../components/ResizableTitle';
import ColumnSelector from '../components/ColumnSelector';
import { useColumnSettings } from '../hooks/useColumnSettings';
import { useInvoiceStatistics } from '../hooks/useInvoiceStatistics';
import MetricCard from '../components/dashboard/MetricCard';
import ControlBar from '../components/dashboard/ControlBar';
import styles from './InvoiceListPage.module.css';
import 'react-resizable/css/styles.css';

const statusColors: Record<string, string> = {
  '已上传': 'default',
  '解析中': 'processing',
  '待处理': 'blue',
  '待确认': 'warning',
  '已确认': 'success',
  '已报销': 'green',
  '未报销': 'orange',
};

function InvoiceListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);

  // 当前用户
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [ownerFilter, setOwnerFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [searchValue, setSearchValue] = useState<string>('');

  // 报销单相关的 State
  const [isReimburseModalVisible, setIsReimburseModalVisible] = useState(false);
  const [reimbursing, setReimbursing] = useState(false);
  const [reimburseForm] = Form.useForm();
  const [projectList, setProjectList] = useState<{ code: string; name: string; remaining: number | string }[]>([]);
  const [bankCards, setBankCards] = useState<{ id: number; label: string }[]>([]);
  const [approvedApps, setApprovedApps] = useState<{ id: number; title: string; amount: number; used: number; project_code: string | null }[]>([]);
  const [approvedBorrowings, setApprovedBorrowings] = useState<{ id: number; title: string; amount: number }[]>([]);
  const [reasonCategories, setReasonCategories] = useState<ReasonCategory[]>([]);
  const [reimbReasonCategory, setReimbReasonCategory] = useState('');
  const [reimbReasonDetail, setReimbReasonDetail] = useState('');
  const [categoryHint, setCategoryHint] = useState('');           // 智能建议提示文字

  // 根据已选发票智能建议事由类别
  const autoFillCategory = async (invoiceIds: number[]) => {
    if (invoiceIds.length === 0) return;
    try {
      const res = await suggestCategory({ invoice_ids: invoiceIds });
      if (res.mode === 'suggestion' && res.suggested_category_name) {
        setReimbReasonCategory(res.suggested_category_name);
        setReimbReasonDetail('');
        setCategoryHint(res.hint);
      } else {
        setCategoryHint(res.hint || '');
      }
    } catch {
      setCategoryHint('');
    }
  };

  // 加载项目列表、银行卡、已通过的申请单
  const loadFormData = async () => {
    try {
      const [projects, cards, apps, borrowings, rcs] = await Promise.all([getProjects(), getBankCards(), getApplications(), getBorrowings(), getReasonCategories()]);
      setProjectList(projects.map(p => ({ code: p.project_code, name: p.project_name, remaining: p.remaining })));
      setBankCards(cards.map(c => ({
        id: c.id,
        label: `${c.bank_name} ····${c.card_number.slice(-4)} ${c.is_default ? '(默认)' : ''} — ${c.account_name}`,
      })));
      setApprovedApps(apps.filter(a => a.status === '已通过').map(a => ({
        id: a.id, title: a.title, amount: a.estimated_amount, used: a.used_amount || 0, project_code: a.project_code,
      })));
      setApprovedBorrowings(borrowings.filter(b => b.status === '已批准').map(b => ({
        id: b.id, title: b.title, amount: b.estimated_amount,
      })));
      setReasonCategories(rcs);
    } catch {}
  };

  // 选中的申请单金额，用于超额预警
  const [selectedAppAmount, setSelectedAppAmount] = useState<number>(0);

  // 选中发票的合计金额
  const selectedInvoicesTotal = useMemo(() => {
    return invoices
      .filter(item => selectedRowKeys.includes(item.id))
      .reduce((sum, item) => sum + (Number(item.total_with_tax) || 0), 0);
  }, [invoices, selectedRowKeys]);

  // 用于轮询的 Ref
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchInvoicesRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

  // Column settings
  const {
    columnConfigs,
    setColumnConfigs,
    columnWidths,
    handleColumnResize,
    visibleColumns,
  } = useColumnSettings();

  // 加入 silent 参数，静默刷新时不会触发全局 loading 动画
  const fetchInvoices = async (silent: boolean = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (ownerFilter) params.owner = ownerFilter;
      if (dateRange?.[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange?.[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
      if (searchValue) params.invoice_number = searchValue;

      const response = await listInvoices(params);
      setInvoices(response.items);
      setTotal(response.total);
    } catch (error) {
      if (!silent) message.error('获取发票列表失败');
      console.error(error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 始终保持最新的 fetch 函数给定时器使用
  useEffect(() => {
    fetchInvoicesRef.current = fetchInvoices;
  });

  const fetchStatistics = async () => {
    if (selectedRowKeys.length === 0) {
      setStatistics(null);
      return;
    }

    try {
      const stats = await getStatistics(selectedRowKeys);
      setStatistics(stats);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [page, pageSize, statusFilter, ownerFilter, dateRange, searchValue]);

  useEffect(() => {
    fetchStatistics();
  }, [selectedRowKeys]);

  // 初始化当前用户
  useEffect(() => {
    const saved = localStorage.getItem('currentUser');
    if (saved) setCurrentUser(JSON.parse(saved));
  }, []);

  // 一键确认：自动确认所有无冲突的「待确认」发票
  const handleAutoConfirm = () => {
    Modal.confirm({
      title: '一键确认',
      content: '系统将自动检查所选发票，仅确认无 OCR/LLM 冲突且字段完整的发票。有差异的仍需手动处理。',
      okText: '开始确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await autoConfirmInvoices(selectedRowKeys);
          if (res.confirmed_ids.length > 0) {
            message.success(`${res.message}${res.need_manual_ids.length > 0 ? `，${res.need_manual_ids.length} 张需手动处理` : ''}`);
          } else {
            message.warning('所选发票均存在冲突或字段缺失，请手动处理');
          }
          setSelectedRowKeys([]);
          fetchInvoices();
        } catch (error) {
          message.error('一键确认失败');
        }
      },
    });
  };

  // ====== 智能静默轮询机制 ======
  useEffect(() => {
    // 🚨 修复 TS 报错：强制转成 string 进行比对
    const hasProcessingInvoices = invoices.some(inv => {
      const s = inv.status as unknown as string;
      return s === '已上传' || s === '解析中' || s === 'UPLOADED' || s === 'PROCESSING';
    });

    if (hasProcessingInvoices) {
      if (!pollingTimerRef.current) {
        pollingTimerRef.current = setInterval(() => {
          if (fetchInvoicesRef.current) fetchInvoicesRef.current(true);
        }, 3000);
      }
    } else {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    }

    // 组件卸载时清理定时器
    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [invoices]);

  const handleStatusChange = (value: string | undefined) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    setPage(1);
  };

  const handleDateRangeChange = (range: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => {
    setDateRange(range);
    setPage(1);
  };

  const handleOwnerChange = (value: string) => {
    setOwnerFilter(value);
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInvoice(id);
      message.success('删除成功');
      fetchInvoices();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleBatchUpdate = async (status: string) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择发票');
      return;
    }

    try {
      await batchUpdateInvoices(selectedRowKeys, status);
      message.success('批量更新成功');
      setSelectedRowKeys([]);
      fetchInvoices();
    } catch (error) {
      message.error('批量更新失败');
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择发票');
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 张发票吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await batchDeleteInvoices(selectedRowKeys);
          message.success(result.message);
          setSelectedRowKeys([]);
          fetchInvoices();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const handleBatchReprocess = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择发票');
      return;
    }

    Modal.confirm({
      title: '确认重新解析',
      content: `确定要重新解析选中的 ${selectedRowKeys.length} 张发票吗？旧的解析结果将被清除。`,
      okText: '确认重新解析',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await batchReprocessInvoices(selectedRowKeys);
          message.success(result.message);
          setSelectedRowKeys([]);
          fetchInvoices();
        } catch (error) {
          message.error('批量重新解析失败');
        }
      },
    });
  };

  // ====== 打开报销弹窗前的双重校验 ======
  const handleOpenReimburseModal = () => {
    loadFormData();  // 加载最新项目列表+银行卡
    // 🚨 修复 TS 报错：强制转成 string 进行比对
    const allSelectedConfirmed = invoices
      .filter(item => selectedRowKeys.includes(item.id))
      .every(item => {
        const s = item.status as unknown as string;
        return s === '已确认' || s === 'CONFIRMED' || s === InvoiceStatus.CONFIRMED;
      });

    if (!allSelectedConfirmed) {
      message.warning('含有未确认的发票！请仅勾选状态为”已确认”的发票进行报销。');
      return;
    }
    setIsReimburseModalVisible(true);
    // 打开弹窗时立刻分析发票类别，自动填入建议
    autoFillCategory(selectedRowKeys);
  };

  const handleCreateReimbursement = async () => {
    if (!reimbReasonCategory) { message.warning('请选择事由类别'); return; }
    try {
      const values = await reimburseForm.validateFields();
      const fullTitle = reimbReasonCategory + (reimbReasonDetail.trim() ? `-${reimbReasonDetail.trim()}` : '');
      const selectedRc = reasonCategories.find(rc => rc.name === reimbReasonCategory);
      setReimbursing(true);
      await createReimbursement({
        title: fullTitle,
        project_code: values.project_code,
        invoice_ids: selectedRowKeys,
        bank_card_id: values.bank_card_id,
        application_id: values.application_id,
        borrowing_id: values.borrowing_id,
        reason_category_id: selectedRc?.id,
      });
      message.success('报销单提交成功！');
      setIsReimburseModalVisible(false);
      reimburseForm.resetFields();
      setReimbReasonCategory(''); setReimbReasonDetail(''); setCategoryHint('');
      setSelectedRowKeys([]);
      fetchInvoices();
    } catch (error: any) {
      const msg = error?.response?.data?.detail || '创建报销单失败，请重试';
      message.error(msg);
    } finally {
      setReimbursing(false);
    }
  };

  const handleExport = async (format: 'csv' | 'excel') => {
    const params = new URLSearchParams();

    if (selectedRowKeys.length > 0) {
      params.append('invoice_ids', selectedRowKeys.join(','));
    }
    if (statusFilter) {
      params.append('status', statusFilter);
    }
    if (ownerFilter) {
      params.append('owner', ownerFilter);
    }
    if (dateRange?.[0]) {
      params.append('start_date', dateRange[0].format('YYYY-MM-DD'));
    }
    if (dateRange?.[1]) {
      params.append('end_date', dateRange[1].format('YYYY-MM-DD'));
    }

    const url = `/api/invoices/export/${format}?${params.toString()}`;
    try {
      const token = localStorage.getItem('sessionToken');
      const res = await fetch(url, { headers: { 'X-Session-Token': token || '' } });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const ext = format === 'excel' ? 'xlsx' : 'csv';
      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `发票导出.${ext}`;
      a.click();
      window.URL.revokeObjectURL(objUrl);
    } catch { message.error('导出失败'); }
  };

  // All column definitions
  const allColumnDefinitions: Record<string, ColumnsType<Invoice>[number]> = useMemo(
    () => ({
      invoice_number: {
        title: '发票号码',
        dataIndex: 'invoice_number',
        key: 'invoice_number',
        width: columnWidths.invoice_number,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.invoice_number,
          onResize: handleColumnResize('invoice_number'),
        }),
      },
      issue_date: {
        title: '开票日期',
        dataIndex: 'issue_date',
        key: 'issue_date',
        width: columnWidths.issue_date,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.issue_date,
          onResize: handleColumnResize('issue_date'),
        }),
      },
      buyer_name: {
        title: '购买方',
        dataIndex: 'buyer_name',
        key: 'buyer_name',
        width: columnWidths.buyer_name,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.buyer_name,
          onResize: handleColumnResize('buyer_name'),
        }),
      },
      buyer_tax_id: {
        title: '购买方税号',
        dataIndex: 'buyer_tax_id',
        key: 'buyer_tax_id',
        width: columnWidths.buyer_tax_id,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.buyer_tax_id,
          onResize: handleColumnResize('buyer_tax_id'),
        }),
      },
      seller_name: {
        title: '销售方',
        dataIndex: 'seller_name',
        key: 'seller_name',
        width: columnWidths.seller_name,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.seller_name,
          onResize: handleColumnResize('seller_name'),
        }),
      },
      seller_tax_id: {
        title: '销售方税号',
        dataIndex: 'seller_tax_id',
        key: 'seller_tax_id',
        width: columnWidths.seller_tax_id,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.seller_tax_id,
          onResize: handleColumnResize('seller_tax_id'),
        }),
      },
      item_name: {
        title: '项目名称',
        dataIndex: 'item_name',
        key: 'item_name',
        width: columnWidths.item_name,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.item_name,
          onResize: handleColumnResize('item_name'),
        }),
      },
      specification: {
        title: '规格型号',
        dataIndex: 'specification',
        key: 'specification',
        width: columnWidths.specification,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.specification,
          onResize: handleColumnResize('specification'),
        }),
      },
      unit: {
        title: '单位',
        dataIndex: 'unit',
        key: 'unit',
        width: columnWidths.unit,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.unit,
          onResize: handleColumnResize('unit'),
        }),
      },
      quantity: {
        title: '数量',
        dataIndex: 'quantity',
        key: 'quantity',
        width: columnWidths.quantity,
        align: 'right',
        render: (val) => (val != null ? Number(val) : '-'),
        onHeaderCell: () => ({
          width: columnWidths.quantity,
          onResize: handleColumnResize('quantity'),
        }),
      },
      unit_price: {
        title: '单价',
        dataIndex: 'unit_price',
        key: 'unit_price',
        width: columnWidths.unit_price,
        align: 'right',
        render: (val) => (val != null ? `¥${Number(val).toFixed(4)}` : '-'),
        onHeaderCell: () => ({
          width: columnWidths.unit_price,
          onResize: handleColumnResize('unit_price'),
        }),
      },
      amount: {
        title: '金额(不含税)',
        dataIndex: 'amount',
        key: 'amount',
        width: columnWidths.amount,
        align: 'right',
        render: (val) => (val != null ? `¥${Number(val).toFixed(2)}` : '-'),
        onHeaderCell: () => ({
          width: columnWidths.amount,
          onResize: handleColumnResize('amount'),
        }),
      },
      tax_rate: {
        title: '税率',
        dataIndex: 'tax_rate',
        key: 'tax_rate',
        width: columnWidths.tax_rate,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.tax_rate,
          onResize: handleColumnResize('tax_rate'),
        }),
      },
      tax_amount: {
        title: '税额',
        dataIndex: 'tax_amount',
        key: 'tax_amount',
        width: columnWidths.tax_amount,
        align: 'right',
        render: (val) => (val != null ? `¥${Number(val).toFixed(2)}` : '-'),
        onHeaderCell: () => ({
          width: columnWidths.tax_amount,
          onResize: handleColumnResize('tax_amount'),
        }),
      },
      total_with_tax: {
        title: '价税合计',
        dataIndex: 'total_with_tax',
        key: 'total_with_tax',
        width: columnWidths.total_with_tax,
        align: 'right',
        render: (val) => (val != null ? `¥${Number(val).toFixed(2)}` : '-'),
        onHeaderCell: () => ({
          width: columnWidths.total_with_tax,
          onResize: handleColumnResize('total_with_tax'),
        }),
      },
      status: {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: columnWidths.status,
        render: (status: string) => (
          <Tag color={statusColors[status] || 'default'}>{status}</Tag>
        ),
        onHeaderCell: () => ({
          width: columnWidths.status,
          onResize: handleColumnResize('status'),
        }),
      },
      owner: {
        title: '归属人',
        dataIndex: 'owner',
        key: 'owner',
        width: columnWidths.owner,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.owner,
          onResize: handleColumnResize('owner'),
        }),
      },
      file_name: {
        title: '文件名',
        dataIndex: 'file_name',
        key: 'file_name',
        width: columnWidths.file_name,
        ellipsis: true,
        render: (val) => val || '-',
        onHeaderCell: () => ({
          width: columnWidths.file_name,
          onResize: handleColumnResize('file_name'),
        }),
      },
      created_at: {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: columnWidths.created_at,
        render: (val) => (val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-'),
        onHeaderCell: () => ({
          width: columnWidths.created_at,
          onResize: handleColumnResize('created_at'),
        }),
      },
      updated_at: {
        title: '更新时间',
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: columnWidths.updated_at,
        render: (val) => (val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-'),
        onHeaderCell: () => ({
          width: columnWidths.updated_at,
          onResize: handleColumnResize('updated_at'),
        }),
      },
      action: {
        title: '操作',
        key: 'action',
        width: columnWidths.action,
        fixed: 'right' as const,
        render: (_, record) => (
          <Space>
            <Button
              type="link"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/invoices/${record.id}`)}
            >
              详情
            </Button>
            <Popconfirm
              title="确定删除？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      },
    }),
    [columnWidths, handleColumnResize, navigate]
  );

  // Build columns based on visible column configs
  const columns: ColumnsType<Invoice> = useMemo(() => {
    return visibleColumns
      .map((config) => allColumnDefinitions[config.key])
      .filter(Boolean);
  }, [visibleColumns, allColumnDefinitions]);

  // Calculate total scroll width
  const scrollX = useMemo(() => {
    return visibleColumns.reduce(
      (sum, col) => sum + (columnWidths[col.key] || 100),
      0
    );
  }, [visibleColumns, columnWidths]);

  // Calculate statistics from current page invoices
  const pageStatistics = useInvoiceStatistics(invoices);

  // Generate total text for control bar
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const displayStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const displayEnd = total === 0 ? 0 : Math.min(page * pageSize, total);

  const totalText = useMemo(() => {
    return `显示 ${displayStart}-${displayEnd} 条，共 ${total} 条`;
  }, [displayStart, displayEnd, total]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Table components with resizable header
  const tableComponents = {
    header: {
      cell: ResizableTitle,
    },
  };

  return (
    <div className={styles.pageContainer}>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>发票列表</h1>
          <p className={styles.pageSubtitle}>管理和查看所有发票记录</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => handleExport('excel')}
            className={styles.secondaryButton}
          >
            导出Excel
          </Button>
          <Button
            icon={<UploadOutlined />}
            onClick={() => navigate('/upload')}
            className={styles.primaryButton}
          >
            上传发票
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className={styles.metricsSection}>
        <MetricCard
          label="发票数量"
          value={pageStatistics.count}
          icon={<FileTextOutlined style={{ fontSize: 20 }} />}
          gradient="#4F46E5, #6366F1"
        />
        <MetricCard
          label="金额合计"
          value={pageStatistics.totalAmount.toFixed(2)}
          prefix="¥"
          icon={<DollarOutlined style={{ fontSize: 20 }} />}
          gradient="#10B981, #34D399"
        />
        <MetricCard
          label="税额合计"
          value={pageStatistics.totalTax.toFixed(2)}
          prefix="¥"
          icon={<PercentageOutlined style={{ fontSize: 20 }} />}
          gradient="#F59E0B, #FBBF24"
        />
        <MetricCard
          label="价税合计"
          value={pageStatistics.totalWithTax.toFixed(2)}
          prefix="¥"
          icon={<RiseOutlined style={{ fontSize: 20 }} />}
          gradient="#8B5CF6, #A78BFA"
        />
      </div>

      {/* Selected Statistics Card */}
      {statistics && (
        <Card style={{ marginBottom: 32 }}>
          <Row gutter={24}>
            <Col span={6}>
              <Statistic title="选中数量" value={statistics.count} suffix="张" />
            </Col>
            <Col span={6}>
              <Statistic
                title="金额合计"
                value={statistics.total_amount}
                precision={2}
                prefix="¥"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="税额合计"
                value={statistics.total_tax}
                precision={2}
                prefix="¥"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="价税合计"
                value={statistics.total_with_tax}
                precision={2}
                prefix="¥"
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* Control Bar */}
      <ControlBar
        searchPlaceholder="搜索发票号码..."
        searchValue={searchValue}
        onSearchChange={handleSearchChange}
        statusFilter={statusFilter}
        onStatusChange={handleStatusChange}
        statusOptions={Object.values(InvoiceStatus).map((s) => ({ label: s, value: s }))}
        dateRange={dateRange}
        onDateRangeChange={handleDateRangeChange}
        totalText={totalText}
      />

      {/* Additional Controls */}
      <div className={styles.additionalControls}>
        <Input
          placeholder="归属人"
          style={{ width: 120 }}
          value={ownerFilter}
          onChange={(e) => handleOwnerChange(e.target.value)}
          onPressEnter={() => fetchInvoices()}
        />

        <Button icon={<ReloadOutlined />} onClick={() => fetchInvoices()}>
          刷新
        </Button>

        <Button icon={<DownloadOutlined />} onClick={() => handleExport('csv')}>
          导出CSV
        </Button>

        <ColumnSelector columns={columnConfigs} onChange={setColumnConfigs} />

        {selectedRowKeys.length > 0 && (
          <>
            <div className={styles.controlDivider} />
            <span className={styles.selectedBadge}>
              已选择 {selectedRowKeys.length} 项
            </span>

            {/* ====== 打包报销：员工和管理员都有 ====== */}
            <Button
              type="primary"
              icon={<AuditOutlined />}
              onClick={handleOpenReimburseModal}
            >
              打包报销 (已选 {selectedRowKeys.length} 张)
            </Button>

            {currentUser?.role !== 'admin' ? (
              /* ====== 员工端额外操作：一键确认 ====== */
              <Button icon={<CheckOutlined />} onClick={handleAutoConfirm}>
                一键确认
              </Button>
            ) : (
              /* ====== 管理员端额外操作：批量管理 ====== */
              <>
                <Select
                  placeholder="批量修改状态"
                  style={{ width: 140 }}
                  onChange={handleBatchUpdate}
                  options={Object.values(InvoiceStatus).map((s) => ({ label: s, value: s }))}
                />
                <Button icon={<SyncOutlined />} onClick={handleBatchReprocess}>
                  重新解析
                </Button>
                <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                  批量删除
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className={styles.tableContainer}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={invoices}
          components={tableComponents}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as number[]),
            getCheckboxProps: (record) => {
              // 已被报销单占用的发票不可再选（任何操作）
              if (record.reimbursement_id != null) return { disabled: true };
              // 其他状态均可选中，具体操作限制由各按钮自行校验
              return { disabled: false };
            },
          }}
          pagination={false}
          scroll={{ x: scrollX }}
          className={styles.invoiceTable}
        />
      </div>

      {/* Custom Pagination */}
      <div className={styles.paginationRow}>
        <div className={styles.paginationLeft}>
          <span className={styles.paginationText}>
            显示 {displayStart}-{displayEnd} 共 {total} 条
          </span>
        </div>
        <div className={styles.paginationRight}>
          <Button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className={styles.pageNumbers}>
            {page} / {totalPages}
          </span>
          <Button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
          <Select
            value={pageSize}
            onChange={(val) => {
              setPageSize(val);
              setPage(1);
            }}
            options={[
              { label: '10 条/页', value: 10 },
              { label: '20 条/页', value: 20 },
              { label: '50 条/页', value: 50 },
              { label: '100 条/页', value: 100 },
            ]}
            style={{ width: 120, marginLeft: 12 }}
          />
        </div>
      </div>

      {/* ====== 报销单填写弹窗 ====== */}
      <Modal
        title="发起打包报销"
        open={isReimburseModalVisible}
        onOk={handleCreateReimbursement}
        onCancel={() => {
          setIsReimburseModalVisible(false);
          reimburseForm.resetFields();
          setReimbReasonCategory(''); setReimbReasonDetail(''); setCategoryHint('');
        }}
        confirmLoading={reimbursing}
        okText="提交审批"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          您已选中 <strong style={{ color: '#1890ff' }}>{selectedRowKeys.length}</strong> 张发票，总金额将自动计算。
        </div>
        {categoryHint && (
          <div style={{
            marginBottom: 16, padding: '10px 14px',
            background: 'linear-gradient(135deg, #f6ffed 0%, #e6f7ff 100%)',
            border: '1px solid #b7eb8f',
            borderRadius: 8, fontSize: 13, color: '#389e0d',
          }}>
            💡 {categoryHint}
          </div>
        )}
        <Form form={reimburseForm} layout="vertical">
          <div style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>报销事由 <span style={{ color: '#E42313' }}>*</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                value={reimbReasonCategory || undefined}
                onChange={(v) => setReimbReasonCategory(v)}
                placeholder="选择事由类别"
                style={{ flex: '0 0 160px' }}
                options={reasonCategories.map(rc => ({ value: rc.name, label: rc.name }))}
              />
              <Input
                value={reimbReasonDetail}
                onChange={(e) => setReimbReasonDetail(e.target.value)}
                placeholder="具体描述（如：北京客户拜访）"
                style={{ flex: 1 }}
              />
            </div>
          </div>
          <Form.Item
            name="project_code"
            label="项目编号 / 课题组编号"
            rules={[{ required: true, message: '请选择关联的项目' }]}
          >
            <Select
              showSearch
              placeholder="请选择项目"
              options={projectList.map(p => ({
                value: p.code,
                label: `${p.code} — ${p.name} (剩余 ¥${Number(p.remaining).toFixed(0)})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="application_id"
            label="关联事前申请单"
            help={selectedAppAmount > 0 ? `选中发票合计 ¥${selectedInvoicesTotal.toFixed(2)}，申请单额度 ¥${selectedAppAmount.toFixed(2)}` : ''}
          >
            <Select
              placeholder="选择已通过的事前申请（选填）"
              allowClear
              onChange={(val) => {
                const app = approvedApps.find(a => a.id === val);
                setSelectedAppAmount(app ? app.amount : 0);
                if (app) {
                  const dashIndex = app.title.indexOf('-');
                  if (dashIndex > 0) {
                    setReimbReasonCategory(app.title.substring(0, dashIndex));
                    setReimbReasonDetail(app.title.substring(dashIndex + 1));
                  } else {
                    setReimbReasonCategory(app.title);
                    setReimbReasonDetail('');
                  }
                  if (app.project_code) {
                    reimburseForm.setFieldsValue({ project_code: app.project_code });
                  }
                } else {
                  // 清空申请单 → 重新分析发票类别，自动填入建议
                  setReimbReasonCategory('');
                  setReimbReasonDetail('');
                  setSelectedAppAmount(0);
                  autoFillCategory(selectedRowKeys);
                }
              }}
              options={approvedApps.map(a => ({
                value: a.id,
                label: `${a.title} — 预估 ¥${Number(a.amount).toFixed(0)}（已用 ¥${a.used.toFixed(0)}）`,
              }))}
              notFoundContent="暂无已通过的申请单，请先在「事前申请」页面提交"
            />
            {selectedAppAmount > 0 && selectedInvoicesTotal > selectedAppAmount && (
              <div style={{
                marginTop: 8, padding: '8px 12px',
                background: '#fff2f0', border: '1px solid #ffccc7',
                borderRadius: 6, color: '#E42313', fontSize: 13,
              }}>
                ⚠️ 报销金额超出申请额度 ¥{(selectedInvoicesTotal - selectedAppAmount).toFixed(2)}！
                申请额度 ¥{selectedAppAmount.toFixed(2)}，本次报销 ¥{selectedInvoicesTotal.toFixed(2)}
              </div>
            )}
          </Form.Item>
          <Form.Item
            name="borrowing_id"
            label="冲销借款（选填）"
            help="选择已批准的借款申请，报销完成时自动冲销"
          >
            <Select
              placeholder="选择要冲销的借款"
              allowClear
              options={approvedBorrowings.map(b => ({
                value: b.id,
                label: `${b.title} — ¥${Number(b.amount).toFixed(0)}`,
              }))}
              notFoundContent="暂无已批准的借款，请先在「借款申请」页面提交"
            />
          </Form.Item>
          <Form.Item
            name="bank_card_id"
            label="收款银行卡"
          >
            <Select
              placeholder="选择收款账户"
              options={bankCards.map(c => ({ value: c.id, label: c.label }))}
              notFoundContent="暂无银行卡，请先在「收款账户」页面添加"
            />
          </Form.Item>
        </Form>
      </Modal>
      {/* ================================== */}
    </div>
  );
}

export default InvoiceListPage;