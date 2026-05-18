import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, ScrollView, Picker } from '@tarojs/components';
import { createBorrowing, getApplications } from '../../services/api';
import type { ApplicationItem } from '../../types';
import './index.scss';

export default function BorrowingCreatePage() {
  const [amount, setAmount] = useState('');
  const [repayDate, setRepayDate] = useState('');
  const [appId, setAppId] = useState<number | undefined>(undefined);
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getApplications()
      .then(data => setApps(data.filter(a => a.status === '已通过')))
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!amount || Number(amount) <= 0) { Taro.showToast({ title: '请输入借款金额', icon: 'none' }); return; }

    setSubmitting(true);
    try {
      await createBorrowing({
        estimated_amount: Number(amount),
        expected_repayment_date: repayDate || undefined,
        application_id: appId,
      });
      Taro.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1000);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'error' });
    } finally { setSubmitting(false); }
  };

  const selectedApp = apps.find(a => a.id === appId);

  return (
    <View className='bc-page'>
      <ScrollView scrollY style={{ paddingBottom: '140px' }}>
        <View className='bc-card'>
          <Text className='bc-card-title'>借款金额</Text>
          <Input
            className='bc-input amount-input'
            type='digit'
            placeholder='¥ 请输入借款金额'
            placeholderClass='ph'
            value={amount}
            onInput={e => setAmount(e.detail.value)}
          />
        </View>

        <View className='bc-card'>
          <Text className='bc-card-title'>预计还款日期（选填）</Text>
          <Picker mode='date' onChange={e => setRepayDate(e.detail.value)}>
            <View className='picker-box'>
              <Text className={repayDate ? 'picker-val' : 'picker-ph'}>{repayDate || '选择日期'}</Text>
            </View>
          </Picker>
        </View>

        <View className='bc-card'>
          <Text className='bc-card-title'>关联事前申请（选填）</Text>
          {apps.length === 0 ? (
            <Text className='no-data'>暂无可关联的已通过申请</Text>
          ) : (
            <Picker
              mode='selector'
              range={apps.map(a => `${a.title}（额度 ¥${Number(a.estimated_amount).toFixed(0)}）`)}
              onChange={e => setAppId(apps[Number(e.detail.value)]?.id)}
            >
              <View className='picker-box'>
                <Text className={selectedApp ? 'picker-val' : 'picker-ph'}>
                  {selectedApp ? selectedApp.title : '选择关联申请'}
                </Text>
              </View>
            </Picker>
          )}
        </View>
      </ScrollView>

      <View className='submit-bar'>
        <View className='submit-btn' onClick={submitting ? undefined : handleSubmit}>
          <Text className='submit-text'>{submitting ? '提交中...' : '提交借款申请'}</Text>
        </View>
      </View>
    </View>
  );
}
