import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Popover, List, Button, Empty, Typography } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  NotificationItem,
} from '../services/api';

export default function NotificationBell() {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await getUnreadCount();
      setUnread(res.count);
    } catch {}
  }, []);

  const fetchList = useCallback(async () => {
    try {
      const res = await getNotifications();
      setNotifs(res);
    } catch {}
  }, []);

  useEffect(() => { fetchUnread(); }, [fetchUnread]);
  // 每 10 秒轮询未读数
  useEffect(() => {
    const t = setInterval(fetchUnread, 10000);
    return () => clearInterval(t);
  }, [fetchUnread]);

  const handleOpen = (visible: boolean) => {
    setOpen(visible);
    if (visible) fetchList();
  };

  const handleRead = async (item: NotificationItem) => {
    if (!item.is_read) {
      try { await markNotificationRead(item.id); setUnread((n) => Math.max(0, n - 1)); } catch {}
    }
    if (item.entity_type === 'reimbursement' && item.entity_id) {
      // 已撤销/已删除的报销单跳发票列表，其他的跳详情页
      const isCancelled = item.title?.includes('撤销');
      navigate(isCancelled ? '/' : `/reimbursements/${item.entity_id}`);
      setOpen(false);
    }
  };

  const handleReadAll = async () => {
    try { await markAllNotificationsRead(); setUnread(0); fetchList(); } catch {}
  };

  const content = (
    <div style={{ width: 360, maxHeight: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>消息通知</Typography.Text>
        {unread > 0 && (
          <Button type="link" size="small" icon={<CheckOutlined />} onClick={handleReadAll}>
            全部已读
          </Button>
        )}
      </div>
      {notifs.length === 0 ? (
        <Empty description="暂无通知" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          style={{ maxHeight: 340, overflow: 'auto' }}
          dataSource={notifs}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleRead(item)}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                background: item.is_read ? 'transparent' : '#f6ffed',
                borderRadius: 6,
                marginBottom: 4,
                borderLeft: item.is_read ? '3px solid transparent' : '3px solid #E42313',
              }}
            >
              <List.Item.Meta
                title={
                  <span style={{ fontWeight: item.is_read ? 400 : 600, fontSize: 13 }}>
                    {!item.is_read && <span style={{ color: '#E42313', marginRight: 6 }}>●</span>}
                    {item.title}
                  </span>
                }
                description={
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{item.message}</div>
                    <div style={{ fontSize: 11, color: '#999' }}>
                      {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={handleOpen} placement="bottomRight">
      <Badge count={unread} size="small" offset={[-2, 2]}>
        <BellOutlined style={{ fontSize: 20, cursor: 'pointer', color: '#555' }} />
      </Badge>
    </Popover>
  );
}
