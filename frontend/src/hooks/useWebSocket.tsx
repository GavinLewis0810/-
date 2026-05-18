import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notification, Button, Space } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  DollarOutlined,
} from '@ant-design/icons';

interface WsMessage {
  type: 'notification' | 'ping';
  title?: string;
  message?: string;
  entity_type?: string;
  entity_id?: number;
}

// 全局未读数 & 监听器
let globalUnread = 0;
const listeners = new Set<() => void>();

export function getGlobalUnread() { return globalUnread; }
export function onUnreadChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyListeners() { listeners.forEach((fn) => fn()); }

export function setGlobalUnread(count: number) {
  globalUnread = count;
  notifyListeners();
}
export function incGlobalUnread(n = 1) {
  globalUnread += n;
  notifyListeners();
}
export function decGlobalUnread(n = 1) {
  globalUnread = Math.max(0, globalUnread - n);
  notifyListeners();
}

type NotifStyle = 'success' | 'error' | 'warning' | 'info';

function getStyle(title: string): { icon: React.ReactNode; color: string; bg: string; style: NotifStyle } {
  if (/通过|批准|已打款|到账|已冲销/.test(title)) {
    return {
      icon: <CheckCircleOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      color: '#52c41a', bg: '#f6ffed',
      style: 'success',
    };
  }
  if (/驳回|拒绝|撤销/.test(title)) {
    return {
      icon: <CloseCircleOutlined style={{ fontSize: 22, color: '#ff4d4f' }} />,
      color: '#ff4d4f', bg: '#fff2f0',
      style: 'error',
    };
  }
  if (/待审批|新.*提交|超额|预警|风险/.test(title)) {
    return {
      icon: <WarningOutlined style={{ fontSize: 22, color: '#faad14' }} />,
      color: '#faad14', bg: '#fffbe6',
      style: 'warning',
    };
  }
  if (/打款|到账|拨款|冲销/.test(title)) {
    return {
      icon: <DollarOutlined style={{ fontSize: 22, color: '#1890ff' }} />,
      color: '#1890ff', bg: '#e6f7ff',
      style: 'info',
    };
  }
  return {
    icon: <InfoCircleOutlined style={{ fontSize: 22, color: '#1677ff' }} />,
    color: '#1677ff', bg: '#f0f5ff',
    style: 'info',
  };
}

export default function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectDelay = useRef(3000);
  const navigate = useNavigate();

  const showToast = useCallback((data: WsMessage) => {
    const { icon, color, bg } = getStyle(data.title || '');
    const hasEntity = !!(data.entity_type && data.entity_id);
    const canNavigate = hasEntity && (
      data.entity_type === 'reimbursement' ||
      data.entity_type === 'application' ||
      data.entity_type === 'borrowing'
    );

    const key = `notif-${Date.now()}`;

    const handleView = () => {
      notification.destroy(key);
      if (data.entity_type === 'reimbursement' && data.entity_id) {
        navigate(`/reimbursements/${data.entity_id}`);
      } else if (data.entity_type === 'application') {
        navigate('/applications');
      } else if (data.entity_type === 'borrowing') {
        navigate('/borrowings');
      }
    };

    notification.open({
      key,
      message: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {icon}
          <span style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>{data.title}</span>
        </div>
      ),
      description: (
        <div>
          <div style={{ color: '#555', fontSize: 13, lineHeight: 1.6, marginBottom: 12, marginTop: 4 }}>
            {data.message}
          </div>
          <Space size={8}>
            {canNavigate && (
              <Button
                size="small"
                type="primary"
                onClick={handleView}
                style={{
                  fontSize: 12,
                  height: 28,
                  borderRadius: 4,
                  background: color,
                  borderColor: color,
                }}
              >
                查看详情
              </Button>
            )}
            <Button
              size="small"
              onClick={() => notification.destroy(key)}
              style={{ fontSize: 12, height: 28, borderRadius: 4 }}
            >
              我知道了
            </Button>
          </Space>
        </div>
      ),
      placement: 'topRight',
      duration: 5,
      onClick: canNavigate ? handleView : undefined,
      style: {
        cursor: canNavigate ? 'pointer' : 'default',
        borderRadius: 8,
        borderLeft: `4px solid ${color}`,
        background: bg,
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        padding: '12px 16px',
      },
    });
  }, [navigate]);

  const connect = useCallback(() => {
    const token = localStorage.getItem('sessionToken');
    if (!token) return;

    const wsUrl = `ws://127.0.0.1:18080/ws/notify?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] 已连接');
      reconnectDelay.current = 3000;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WsMessage = JSON.parse(event.data);
        if (data.type === 'ping') return;

        if (data.type === 'notification') {
          incGlobalUnread(1);
          showToast(data);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      const delay = reconnectDelay.current;
      console.log(`[WS] 断开，${delay / 1000}s 后重连`);
      reconnectTimer.current = window.setTimeout(connect, delay);
      reconnectDelay.current = Math.min(delay * 2, 30000);
    };

    ws.onerror = () => ws.close();
  }, [showToast, navigate]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return null;
}
