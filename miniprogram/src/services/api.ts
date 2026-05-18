// ============================================================
// API 服务层 — 从 Web 端 axios 适配为 Taro.request
// 来源: frontend/src/services/api.ts
// 类型定义 100% 复用, HTTP 传输适配
// ============================================================

import Taro from '@tarojs/taro';
import { storage } from '../utils/storage';
import type {
  Invoice,
  InvoiceListResponse,
  UploadResponse,
  UserProfile,
  Reimbursement,
  ReimbursementCreate,
  ProjectItem,
  NotificationItem,
} from '../types';

// ── 基础配置 ──
// 开发时指向本地后端；上线前改为正式域名
const API_BASE = 'http://10.105.12.33:18080/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  params?: Record<string, any>;
  header?: Record<string, string>;
}

async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', data, params, header = {} } = options;

  const token = storage.getToken();
  if (token) {
    header['X-Session-Token'] = token;
  }
  header['Content-Type'] = 'application/json';

  // 拼接 query string
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  try {
    const res = await Taro.request({
      url,
      method,
      data,
      header,
      timeout: 30000,
    });

    if (res.statusCode === 401) {
      storage.removeToken();
      storage.removeUser();
      Taro.reLaunch({ url: '/pages/index/index' });
      throw new Error('登录已过期');
    }

    if (res.statusCode >= 400) {
      throw new Error((res.data as any)?.detail || `请求失败 (${res.statusCode})`);
    }

    return res.data as T;
  } catch (err: any) {
    if (err.errMsg?.includes('request:fail')) {
      throw new Error('网络异常，请检查网络连接');
    }
    throw err;
  }
}

// ── 认证 ──
export const loginWithPassword = async (username: string, password: string): Promise<{ token: string; user: any }> => {
  return request('/auth/login', { method: 'POST', data: { username, password } });
};

export const healthCheck = async () => request('/health');

// ── 发票 CRUD ──
export interface ListParams {
  page?: number;
  page_size?: number;
  status?: string;
  owner?: string;
  start_date?: string;
  end_date?: string;
}

export const listInvoices = async (params: ListParams = {}): Promise<InvoiceListResponse> => {
  return request('/invoices', { params });
};

export const getInvoice = async (id: number): Promise<Invoice> => {
  return request(`/invoices/${id}`);
};

export const updateInvoice = async (id: number, data: Partial<Invoice>): Promise<Invoice> => {
  return request(`/invoices/${id}`, { method: 'PUT', data });
};

export const deleteInvoice = async (id: number): Promise<void> => {
  return request(`/invoices/${id}`, { method: 'DELETE' });
};

// ── 发票上传（小程序适配）──
export const uploadInvoice = async (filePath: string): Promise<UploadResponse> => {
  const token = storage.getToken();
  const header: Record<string, string> = {};
  if (token) header['X-Session-Token'] = token;

  try {
    const res = await Taro.uploadFile({
      url: `${API_BASE}/invoices/upload`,
      filePath,
      name: 'files',
      header,
      timeout: 60000,
    });
    const data = JSON.parse(res.data);
    if (Array.isArray(data)) return data[0];
    return data;
  } catch (err: any) {
    throw new Error('上传失败: ' + (err.errMsg || '网络异常'));
  }
};

// ── 报销单 CRUD ──
export const getReimbursements = async (): Promise<Reimbursement[]> => {
  return request('/reimbursements');
};

export const getReimbursementDetail = async (id: number): Promise<Reimbursement> => {
  return request(`/reimbursements/${id}`);
};

export const createReimbursement = async (data: ReimbursementCreate): Promise<Reimbursement> => {
  return request('/reimbursements', { method: 'POST', data });
};

export const deleteReimbursement = async (id: number): Promise<void> => {
  return request(`/reimbursements/${id}`, { method: 'DELETE' });
};

export const suggestCategory = async (data: { invoice_ids: number[]; application_id?: number }) => {
  return request('/reimbursements/category-suggestion', { method: 'POST', data });
};

// ── 审批操作 ──
export const reviewReimbursement = async (
  reimbId: number,
  action: 'APPROVE' | 'REJECT',
  reason?: string,
): Promise<Reimbursement> => {
  return request(`/reimbursements/${reimbId}/review`, {
    method: 'PUT',
    data: { action, reject_reason: reason },
  });
};

export const aiCheckReimbursement = (reimbId: number) => {
  return request(`/reimbursements/${reimbId}/ai-check`, { method: 'POST' });
};

export const approveReimbursement = (reimbId: number, reviewNote?: string) => {
  return request(`/reimbursements/${reimbId}/approve`, {
    method: 'PUT',
    data: { review_note: reviewNote || '' },
  });
};

export const rejectReimbursement = (reimbId: number, reason: string) => {
  return request(`/reimbursements/${reimbId}/reject`, {
    method: 'PUT',
    data: { reject_reason: reason },
  });
};

export const completeReimbursement = (reimbId: number) => {
  return request(`/reimbursements/${reimbId}/complete`, { method: 'PUT' });
};

export const getReimbursementTimeline = async (reimbId: number) => {
  return request(`/reimbursements/${reimbId}/timeline`);
};

// ── 大屏 Dashboard ──
export const getDashboardStats = async () => {
  return request('/reimbursements/dashboard/stats');
};

export const getBudgetPrediction = async () => {
  return request('/reimbursements/dashboard/budget-prediction');
};

// ── 项目管理 ──
export const getProjects = async (): Promise<ProjectItem[]> => {
  return request('/projects');
};

// ── 通知 ──
export const getNotifications = async (unreadOnly = false): Promise<NotificationItem[]> => {
  return request('/notifications', { params: unreadOnly ? { unread_only: true } : {} });
};

export const getUnreadCount = async (): Promise<{ count: number }> => {
  return request('/notifications/unread-count');
};

export const markNotificationRead = async (id: number): Promise<void> => {
  return request(`/notifications/${id}/read`, { method: 'POST' });
};

export const markAllNotificationsRead = async (): Promise<void> => {
  return request('/notifications/read-all', { method: 'POST' });
};

// ── 用户信息 ──
export const updateProfile = async (data: {
  full_name?: string;
  department?: string;
  signature?: string;
}) => {
  return request('/auth/profile', { method: 'PUT', data });
};

export const changePassword = async (data: { old_password: string; new_password: string }) => {
  return request('/auth/password', { method: 'PUT', data });
};

// ── 事前申请 ──
import type { ApplicationItem, BorrowingItem, BankCardItem, TransactionItem, ReasonCategory } from '../types';

export const getApplications = async (): Promise<ApplicationItem[]> => {
  return request('/applications');
};

export const createApplication = async (data: {
  title: string; description?: string; estimated_amount: number;
  project_code?: string; reason_category_id?: number;
}): Promise<ApplicationItem> => {
  return request('/applications', { method: 'POST', data });
};

export const approveApplication = async (id: number): Promise<void> => {
  return request(`/applications/${id}/approve`, { method: 'PUT' });
};

export const rejectApplication = async (id: number, reason: string): Promise<void> => {
  return request(`/applications/${id}/reject`, { method: 'PUT', data: { reason } });
};

export const deleteApplication = async (id: number): Promise<void> => {
  return request(`/applications/${id}`, { method: 'DELETE' });
};

// ── 借款 ──
export const getBorrowings = async (): Promise<BorrowingItem[]> => {
  return request('/borrowings');
};

export const createBorrowing = async (data: {
  title?: string; estimated_amount: number;
  expected_repayment_date?: string; application_id?: number;
}): Promise<BorrowingItem> => {
  return request('/borrowings', { method: 'POST', data });
};

export const approveBorrowing = async (id: number): Promise<BorrowingItem> => {
  return request(`/borrowings/${id}/approve`, { method: 'PUT' });
};

export const rejectBorrowing = async (id: number, reason: string): Promise<BorrowingItem> => {
  return request(`/borrowings/${id}/reject`, { method: 'PUT', data: { reason } });
};

export const deleteBorrowing = async (id: number): Promise<void> => {
  return request(`/borrowings/${id}`, { method: 'DELETE' });
};

// ── 银行卡 ──
export const getBankCards = async (): Promise<BankCardItem[]> => {
  return request('/bank-cards');
};

export const addBankCard = async (data: {
  bank_name: string; account_name: string; card_number: string;
}): Promise<BankCardItem> => {
  return request('/bank-cards', { method: 'POST', data });
};

export const setDefaultBankCard = async (id: number): Promise<void> => {
  return request(`/bank-cards/${id}/default`, { method: 'PUT' });
};

export const deleteBankCard = async (id: number): Promise<void> => {
  return request(`/bank-cards/${id}`, { method: 'DELETE' });
};

export const getTransactions = async (): Promise<TransactionItem[]> => {
  return request('/bank-cards/transactions');
};

// ── 事由类别 ──
export const getReasonCategories = async (): Promise<ReasonCategory[]> => {
  return request('/reason-categories');
};
