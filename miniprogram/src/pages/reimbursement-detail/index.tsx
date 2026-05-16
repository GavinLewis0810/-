import { useEffect, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { View, Text, ScrollView, Button, Textarea } from '@tarojs/components';
import { getReimbursementDetail, approveReimbursement, rejectReimbursement, completeReimbursement, getReimbursementTimeline } from '../../services/api';
import { storage } from '../../utils/storage';
import type { Reimbursement } from '../../types';
import './index.scss';

const STATUS_MAP: Record<string, string> = {
  '草稿': 'DRAFT',
  '待审批': 'SUBMITTED',
  '已通过': 'APPROVED',
  '已驳回': 'REJECTED',
  '已打款': 'COMPLETED',
};

export default function ReimbursementDetailPage() {
  const { id } = useRouter().params;
  const [reimb, setReimb] = useState<Reimbursement | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [actionVisible, setActionVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const user = storage.getUser();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (id) { fetchDetail(); fetchTimeline(); }
  }, [id]);

  const fetchDetail = async () => {
    try {
      setReimb(await getReimbursementDetail(Number(id)));
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' });
    }
  };

  const fetchTimeline = async () => {
    try {
      const res = await getReimbursementTimeline(Number(id));
      setTimeline(res.timeline || []);
    } catch { /* */ }
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await approveReimbursement(Number(id), '同意报销');
      Taro.showToast({ title: '审批通过', icon: 'success' });
      setTimeout(() => fetchDetail(), 500);
    } catch { Taro.showToast({ title: '操作失败', icon: 'error' }); }
    finally { setSubmitting(false); setActionVisible(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      Taro.showToast({ title: '请填写驳回理由', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await rejectReimbursement(Number(id), rejectReason);
      Taro.showToast({ title: '已驳回', icon: 'success' });
      setTimeout(() => fetchDetail(), 500);
    } catch { Taro.showToast({ title: '操作失败', icon: 'error' }); }
    finally { setSubmitting(false); setActionVisible(false); }
  };

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      await completeReimbursement(Number(id));
      Taro.showToast({ title: '打款完成', icon: 'success' });
      setTimeout(() => fetchDetail(), 500);
    } catch { Taro.showToast({ title: '操作失败', icon: 'error' }); }
    finally { setSubmitting(false); setActionVisible(false); }
  };

  if (!reimb) {
    return <View className='page'><View className='loading'>加载中...</View></View>;
  }

  return (
    <View className='page'>
      <ScrollView scrollY style={{ height: actionVisible ? '65vh' : 'calc(100vh - 40px)' }}>
        {/* 标题和金额 */}
        <View className='hero-card'>
          <Text className='hero-title'>#{reimb.id} {reimb.title}</Text>
          <Text className='hero-amount'>¥{Number(reimb.total_amount || 0).toLocaleString()}</Text>
          <View className='hero-tags'>
            <Text className={`status-tag status-${reimb.status}`}>{reimb.status}</Text>
            {reimb.ai_risk_level && (
              <Text className={`risk-tag risk-${reimb.ai_risk_level}`}>
                AI:{reimb.ai_risk_level}风险
              </Text>
            )}
          </View>
        </View>

        {/* 基本信息 */}
        <View className='info-card'>
          <Text className='section-title'>基本信息</Text>
          <View className='field-row'><Text className='f-label'>项目</Text><Text className='f-value'>{reimb.project_code || '-'}</Text></View>
          <View className='field-row'><Text className='f-label'>提交人</Text><Text className='f-value'>{reimb.submitter || '-'}</Text></View>
          <View className='field-row'><Text className='f-label'>审批人</Text><Text className='f-value'>{reimb.reviewer || '-'}</Text></View>
          <View className='field-row'><Text className='f-label'>创建时间</Text><Text className='f-value'>{reimb.created_at?.slice(0, 10)}</Text></View>
          {reimb.carbon_kg != null && (
            <View className='field-row'><Text className='f-label'>碳足迹</Text><Text className='f-value'>🌱 {Number(reimb.carbon_kg).toFixed(2)} kg</Text></View>
          )}
        </View>

        {/* AI 审查意见 */}
        {reimb.ai_reason && (
          <View className='info-card ai-card'>
            <Text className='section-title'>🤖 AI 审查意见</Text>
            <Text className='ai-reason'>{reimb.ai_reason}</Text>
          </View>
        )}

        {/* 审批意见 / 驳回理由 */}
        {reimb.reject_reason && (
          <View className='info-card reject-card'>
            <Text className='section-title'>驳回理由</Text>
            <Text className='reject-text'>{reimb.reject_reason}</Text>
          </View>
        )}
        {reimb.review_note && (
          <View className='info-card'>
            <Text className='section-title'>审批意见</Text>
            <Text className='f-value'>{reimb.review_note}</Text>
          </View>
        )}

        {/* 资金时间轴 */}
        {timeline.length > 0 && (
          <View className='info-card'>
            <Text className='section-title'>资金追踪</Text>
            {timeline.map((t, i) => (
              <View key={i} className='timeline-item'>
                <View className={`tl-dot tl-${t.status}`} />
                <View className='tl-content'>
                  <Text className='tl-title'>{t.title}</Text>
                  <Text className='tl-desc'>{t.description}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* 关联发票列表 */}
        {reimb.invoices && reimb.invoices.length > 0 && (
          <View className='info-card'>
            <Text className='section-title'>关联发票 ({reimb.invoices.length})</Text>
            {reimb.invoices.map(inv => (
              <View key={inv.id} className='linked-inv' onClick={() => Taro.navigateTo({ url: `/pages/invoice-detail/index?id=${inv.id}` })}>
                <Text className='li-name'>{inv.file_name}</Text>
                <Text className='li-amount'>¥{Number(inv.total_with_tax || 0).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 底部审批操作栏 */}
      {isAdmin && reimb.status === '待审批' && (
        <View className='action-bar'>
          {actionVisible ? (
            <View className='action-panel'>
              <Textarea
                className='reject-input'
                placeholder='请输入驳回理由...'
                value={rejectReason}
                onInput={e => setRejectReason(e.detail.value)}
              />
              <View className='action-btns'>
                <Button className='btn-approve' onClick={handleApprove} disabled={submitting} loading={submitting}>通过</Button>
                <Button className='btn-reject' onClick={handleReject} disabled={submitting}>驳回</Button>
                <Button className='btn-cancel' onClick={() => setActionVisible(false)}>取消</Button>
              </View>
            </View>
          ) : (
            <Button className='action-btn' onClick={() => setActionVisible(true)}>审批操作</Button>
          )}
        </View>
      )}
      {isAdmin && reimb.status === '已通过' && (
        <View className='action-bar'>
          <Button className='action-btn pay-btn' onClick={handleComplete} disabled={submitting} loading={submitting}>确认打款</Button>
        </View>
      )}
    </View>
  );
}
