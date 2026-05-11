import axios from 'axios';
import type {
  Invoice,
  InvoiceDetail,
  InvoiceListResponse,
  Statistics,
  UploadResponse,
  UserProfile,
} from '../types/invoice';

import type { Reimbursement, ReimbursementCreate } from '../types/invoice';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：自动带上 session token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sessionToken');
  if (token) {
    config.headers['X-Session-Token'] = token;
  }
  return config;
});

// 响应拦截器：401 时自动清理登录态，不再骚扰后端
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('currentUser');
    }
    return Promise.reject(error);
  },
);

// 获取报销单列表
export const getReimbursements = async (): Promise<Reimbursement[]> => {
  const response = await api.get('/reimbursements');
  return response.data;
};

// 获取单个报销单详情（含完整发票数据）
export const getReimbursementDetail = async (id: number): Promise<Reimbursement> => {
  const response = await api.get(`/reimbursements/${id}`);
  return response.data;
};

// 创建报销单（打包发票）
export const createReimbursement = async (data: ReimbursementCreate): Promise<Reimbursement> => {
  const response = await api.post('/reimbursements', data);
  return response.data;
};

// 审批报销单
export const reviewReimbursement = async (reimbId: number, action: 'APPROVE' | 'REJECT', reason?: string): Promise<Reimbursement> => {
  const response = await api.put(`/reimbursements/${reimbId}/review`, { action, reject_reason: reason });
  return response.data;
};


// Health check
export const healthCheck = async () => {
  const response = await api.get('/health');
  return response.data;
};

// Upload invoices
export const uploadInvoices = async (files: File[]): Promise<UploadResponse[]> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await api.post('/invoices/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

// List invoices
export interface ListParams {
  page?: number;
  page_size?: number;
  status?: string;
  owner?: string;
  start_date?: string;
  end_date?: string;
}

export const listInvoices = async (params: ListParams = {}): Promise<InvoiceListResponse> => {
  const response = await api.get('/invoices', { params });
  return response.data;
};

// Get invoice detail
export const getInvoice = async (id: number): Promise<InvoiceDetail> => {
  const response = await api.get(`/invoices/${id}`);
  return response.data;
};

// Verify invoice data integrity
export const verifyInvoice = async (id: number): Promise<{
  invoice_id: number; valid: boolean; stored_hash: string; current_hash: string; message: string;
}> => {
  const response = await api.get(`/invoices/${id}/verify`);
  return response.data;
};

// Get invoice file URL
export const getInvoiceFileUrl = (id: number): string => {
  return `/api/invoices/${id}/file`;
};

// Update invoice
export const updateInvoice = async (
  id: number,
  data: Partial<Invoice>
): Promise<Invoice> => {
  const response = await api.put(`/invoices/${id}`, data);
  return response.data;
};

// Batch update
export const batchUpdateInvoices = async (
  invoiceIds: number[],
  status?: string,
  owner?: string
): Promise<{ message: string; updated_count: number }> => {
  const response = await api.post('/invoices/batch-update', {
    invoice_ids: invoiceIds,
    status,
    owner,
  });
  return response.data;
};

// Delete invoice
export const deleteInvoice = async (id: number): Promise<void> => {
  await api.delete(`/invoices/${id}`);
};

// Batch delete invoices
export const batchDeleteInvoices = async (
  invoiceIds: number[]
): Promise<{ message: string; deleted_count: number }> => {
  const response = await api.post('/invoices/batch-delete', {
    invoice_ids: invoiceIds,
  });
  return response.data;
};

// Get statistics
export const getStatistics = async (
  invoiceIds?: number[],
  status?: string,
  owner?: string
): Promise<Statistics> => {
  const params: Record<string, string> = {};
  if (invoiceIds && invoiceIds.length > 0) {
    params.invoice_ids = invoiceIds.join(',');
  }
  if (status) {
    params.status = status;
  }
  if (owner) {
    params.owner = owner;
  }

  const response = await api.get('/invoices/statistics', { params });
  return response.data;
};

// Resolve parsing diff
export const resolveDiff = async (
  invoiceId: number,
  diffId: number,
  source: 'ocr' | 'llm' | 'custom',
  customValue?: string
): Promise<{ message: string; field_name: string; final_value: string; all_resolved: boolean }> => {
  const response = await api.post(`/invoices/${invoiceId}/diffs/${diffId}/resolve`, {
    source,
    custom_value: customValue,
  });
  return response.data;
};

// Confirm invoice
export const confirmInvoice = async (
  invoiceId: number
): Promise<{ message: string; resolved_count: number }> => {
  const response = await api.post(`/invoices/${invoiceId}/confirm`);
  return response.data;
};

// Auto-confirm invoices without conflicts
export const autoConfirmInvoices = async (
  invoiceIds: number[]
): Promise<{ message: string; confirmed_ids: number[]; need_manual_ids: number[] }> => {
  const response = await api.post('/invoices/auto-confirm', {
    invoice_ids: invoiceIds,
  });
  return response.data;
};

// Re-process invoice (run OCR/LLM again)
export const reprocessInvoice = async (
  invoiceId: number
): Promise<{ message: string; invoice_id: number }> => {
  const response = await api.post(`/invoices/${invoiceId}/process`);
  return response.data;
};

// Batch reprocess invoices (clear old results and re-run OCR/LLM)
export const batchReprocessInvoices = async (
  invoiceIds: number[]
): Promise<{ message: string; count: number }> => {
  const response = await api.post('/invoices/batch-reprocess', {
    invoice_ids: invoiceIds,
  });
  return response.data;
};

// 撤销/删除报销单
export const deleteReimbursement = async (reimbId: number): Promise<void> => {
  await api.delete(`/reimbursements/${reimbId}`);
};
export default api;


// ========== 报销单 AI 审查 & 审批（新增） ==========

/** AI 合规审查 */
export const aiCheckReimbursement = (reimbId: number): Promise<{
  compliance_status: string;
  risk_level: string;
  reason: string;
  remarks?: string;
  details: Array<{
    issue: string;
    severity: string;
    comment: string;
  }>;
}> => {
  return api.post(`/reimbursements/${reimbId}/ai-check`).then(res => res.data);
};

/** 审批通过 */
export const approveReimbursement = (
  reimbId: number,
  reviewNote?: string
): Promise<any> => {
  return api.put(`/reimbursements/${reimbId}/approve`, {
    review_note: reviewNote || '',
  }).then(res => res.data);
};

/** 驳回报销单 */
export const rejectReimbursement = (
  reimbId: number,
  reason: string
): Promise<any> => {
  return api.put(`/reimbursements/${reimbId}/reject`, {
    reject_reason: reason,
  }).then(res => res.data);
};

/** 出纳确认打款 */
export const completeReimbursement = (reimbId: number): Promise<any> => {
  return api.put(`/reimbursements/${reimbId}/complete`).then(res => res.data);
};

// 获取报销单资金追踪时间轴
export const getReimbursementTimeline = async (reimbId: number): Promise<{
  timeline: Array<{
    time: string | null;
    status: 'done' | 'processing' | 'pending' | 'error';
    title: string;
    description: string;
  }>;
  reimbursement_id: number;
}> => {
  const response = await api.get(`/reimbursements/${reimbId}/timeline`);
  return response.data;
};

// 获取大屏真实图表数据
export const getDashboardStats = async () => {
  const response = await api.get('/reimbursements/dashboard/stats');
  return response.data;
};

// ========== 管理员：用户管理 ==========

export interface AdminUserItem {
  id: number;
  username: string;
  full_name: string;
  role: string;
  department: string | null;
  is_active: boolean;
  created_at: string | null;
  invoice_count: number;
  reimbursement_count: number;
}

/** 获取所有用户列表（含发票/报销统计） */
export const getAdminUsers = async (): Promise<AdminUserItem[]> => {
  const response = await api.get('/admin/users');
  return response.data;
};

/** 启用/禁用用户 */
export const toggleUserStatus = async (userId: number): Promise<{ message: string; is_active: boolean }> => {
  const response = await api.put(`/admin/users/${userId}/toggle-status`);
  return response.data;
};

/** 重置用户密码 */
export const resetUserPassword = async (userId: number, newPassword: string): Promise<{ message: string }> => {
  const response = await api.put(`/admin/users/${userId}/reset-password`, { new_password: newPassword });
  return response.data;
};

// ========== 消息通知 ==========

export interface NotificationItem {
  id: number;
  title: string;
  message: string | null;
  is_read: boolean;
  entity_type: string | null;
  entity_id: number | null;
  created_at: string;
}

/** 获取通知列表 */
export const getNotifications = async (unreadOnly = false): Promise<NotificationItem[]> => {
  const response = await api.get('/notifications', { params: unreadOnly ? { unread_only: true } : {} });
  return response.data;
};

/** 获取未读数量 */
export const getUnreadCount = async (): Promise<{ count: number }> => {
  const response = await api.get('/notifications/unread-count');
  return response.data;
};

/** 标记已读 */
export const markNotificationRead = async (id: number): Promise<void> => {
  await api.post(`/notifications/${id}/read`);
};

/** 全部已读 */
export const markAllNotificationsRead = async (): Promise<void> => {
  await api.post('/notifications/read-all');
};

// ========== 项目管理（预算） ==========

export interface ProjectItem {
  id: number;
  project_code: string;
  project_name: string;
  budget: number | string;
  used_amount: number | string;
  remaining: number | string;
  usage_rate: number | string;
  created_at: string;
}

export const getProjects = async (): Promise<ProjectItem[]> => {
  const response = await api.get('/projects');
  return response.data;
};

export const createProject = async (data: { project_code: string; project_name: string; budget: number }): Promise<ProjectItem> => {
  const response = await api.post('/projects', data);
  return response.data;
};

export const updateProject = async (id: number, data: { project_name?: string; budget?: number }): Promise<ProjectItem> => {
  const response = await api.put(`/projects/${id}`, data);
  return response.data;
};

export const deleteProject = async (id: number): Promise<void> => {
  await api.delete(`/projects/${id}`);
};

// ========== 银行卡管理 ==========

export interface BankCardItem {
  id: number;
  bank_name: string;
  account_name: string;
  card_number: string;
  is_default: boolean;
  balance: number;
}

export const getBankCards = async (): Promise<BankCardItem[]> => {
  const response = await api.get('/bank-cards');
  return response.data;
};

export const addBankCard = async (data: { bank_name: string; account_name: string; card_number: string }): Promise<BankCardItem> => {
  const response = await api.post('/bank-cards', data);
  return response.data;
};

export const setDefaultBankCard = async (id: number): Promise<void> => {
  await api.put(`/bank-cards/${id}/default`);
};

export const deleteBankCard = async (id: number): Promise<void> => {
  await api.delete(`/bank-cards/${id}`);
};

export interface TransactionItem {
  id: number;
  type: string;
  amount: number;
  borrowing_id: number | null;
  reimbursement_id: number | null;
  balance_before: number;
  balance_after: number;
  note: string | null;
  created_at: string;
}

export const getTransactions = async (): Promise<TransactionItem[]> => {
  const response = await api.get('/bank-cards/transactions');
  return response.data;
};

// ========== 事前申请单 ==========

export interface ApplicationItem {
  id: number;
  title: string;
  description: string | null;
  estimated_amount: number;
  used_amount: number;
  project_code: string | null;
  project_name: string | null;
  status: string;
  reject_reason: string | null;
  user_name: string | null;
  reason_category_id: number | null;
  created_at: string;
}

export const getApplications = async (): Promise<ApplicationItem[]> => {
  const response = await api.get('/applications');
  return response.data;
};

export const createApplication = async (data: { title: string; description: string; estimated_amount: number; project_code?: string; reason_category_id?: number }): Promise<ApplicationItem> => {
  const response = await api.post('/applications', data);
  return response.data;
};

export const approveApplication = async (id: number): Promise<void> => {
  await api.put(`/applications/${id}/approve`);
};

export const rejectApplication = async (id: number, reason: string): Promise<void> => {
  await api.put(`/applications/${id}/reject`, { reason });
};

export const deleteApplication = async (id: number): Promise<void> => {
  await api.delete(`/applications/${id}`);
};

// ========== 事由类别 ==========

export interface ReasonCategory {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export const getReasonCategories = async (): Promise<ReasonCategory[]> => {
  const response = await api.get('/reason-categories');
  return response.data;
};

// ========== 动态审批规则 ==========

export interface ApprovalRuleItem {
  id: number;
  name: string;
  entity_type: string;
  priority: number;
  conditions: any;
  action: string;
  is_active: boolean;
  created_at: string | null;
}

export const getApprovalRules = async (entity_type?: string): Promise<ApprovalRuleItem[]> => {
  const response = await api.get('/approval-rules', { params: entity_type ? { entity_type } : {} });
  return response.data;
};

export const createApprovalRule = async (data: {
  name: string; entity_type?: string; priority: number; conditions: any; action: string; is_active: boolean;
}): Promise<ApprovalRuleItem> => {
  const response = await api.post('/approval-rules', data);
  return response.data;
};

export const updateApprovalRule = async (id: number, data: {
  name: string; entity_type?: string; priority: number; conditions: any; action: string; is_active: boolean;
}): Promise<ApprovalRuleItem> => {
  const response = await api.put(`/approval-rules/${id}`, data);
  return response.data;
};

export const deleteApprovalRule = async (id: number): Promise<void> => {
  await api.delete(`/approval-rules/${id}`);
};

// ========== 个人信息 & 电子签名 ==========

export const updateProfile = async (data: {
  full_name?: string;
  department?: string;
  signature?: string;
}): Promise<{ message: string; user: UserProfile }> => {
  const response = await api.put('/auth/profile', data);
  return response.data;
};

export const changePassword = async (data: {
  old_password: string;
  new_password: string;
}): Promise<{ message: string }> => {
  const response = await api.put('/auth/password', data);
  return response.data;
};

// ========== 借款申请 ==========

export interface BorrowingItem {
  id: number;
  title: string;
  estimated_amount: number;
  expected_repayment_date: string | null;
  status: string;
  reject_reason: string | null;
  repaid_amount: number | null;
  reimbursement_id: number | null;
  application_id: number | null;
  application_title: string | null;
  user_name: string | null;
  approver_name: string | null;
  created_at: string | null;
}

export const getBorrowings = async (): Promise<BorrowingItem[]> => {
  const response = await api.get('/borrowings');
  return response.data;
};

export const createBorrowing = async (data: {
  title?: string;
  estimated_amount: number;
  expected_repayment_date?: string;
  application_id?: number;
}): Promise<BorrowingItem> => {
  const response = await api.post('/borrowings', data);
  return response.data;
};

export const approveBorrowing = async (id: number): Promise<BorrowingItem> => {
  const response = await api.put(`/borrowings/${id}/approve`);
  return response.data;
};

export const rejectBorrowing = async (id: number, reason: string): Promise<BorrowingItem> => {
  const response = await api.put(`/borrowings/${id}/reject`, { reason });
  return response.data;
};

export const deleteBorrowing = async (id: number): Promise<void> => {
  await api.delete(`/borrowings/${id}`);
};