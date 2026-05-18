import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, ScrollView, Picker } from '@tarojs/components';
import { getProjects, createApplication, getReasonCategories } from '../../services/api';
import type { ProjectItem, ReasonCategory } from '../../types';
import './index.scss';

export default function ApplicationCreatePage() {
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [categories, setCategories] = useState<ReasonCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getProjects().then(ps => setProjects(ps)).catch(() => {});
    getReasonCategories().then(rcs => setCategories(rcs)).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!category) { Taro.showToast({ title: '请选择申请事由类别', icon: 'none' }); return; }
    if (!amount || Number(amount) <= 0) { Taro.showToast({ title: '请输入有效预估金额', icon: 'none' }); return; }

    const fullTitle = category + (detail.trim() ? `-${detail.trim()}` : '');
    const selectedRc = categories.find(rc => rc.name === category);

    setSubmitting(true);
    try {
      await createApplication({
        title: fullTitle,
        description: desc || undefined,
        estimated_amount: Number(amount),
        project_code: projectCode || undefined,
        reason_category_id: selectedRc?.id,
      });
      Taro.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1000);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'error' });
    } finally { setSubmitting(false); }
  };

  return (
    <View className='ac-page'>
      <ScrollView scrollY style={{ paddingBottom: '140px' }}>
        {/* 事由类别 */}
        <View className='ac-card'>
          <Text className='ac-card-title'>申请事由</Text>
          <Picker
            mode='selector'
            range={categories.map(rc => rc.name)}
            onChange={e => setCategory(categories[Number(e.detail.value)]?.name || '')}
          >
            <View className='picker-box'>
              <Text className={category ? 'picker-val' : 'picker-ph'}>{category || '选择事由类别'}</Text>
            </View>
          </Picker>
          <Input
            className='ac-input'
            placeholder='具体描述（如：北京客户拜访）'
            placeholderClass='ph'
            value={detail}
            onInput={e => setDetail(e.detail.value)}
          />
        </View>

        {/* 预估金额 */}
        <View className='ac-card'>
          <Text className='ac-card-title'>预估金额</Text>
          <Input
            className='ac-input amount-input'
            type='digit'
            placeholder='¥ 请输入预估金额'
            placeholderClass='ph'
            value={amount}
            onInput={e => setAmount(e.detail.value)}
          />
        </View>

        {/* 关联项目 */}
        <View className='ac-card'>
          <Text className='ac-card-title'>关联项目（选填）</Text>
          <Picker
            mode='selector'
            range={projects.map(p => `${p.project_code} — ${p.project_name}（剩余 ¥${Number(p.remaining).toFixed(0)}）`)}
            onChange={e => setProjectCode(projects[Number(e.detail.value)]?.project_code || '')}
          >
            <View className='picker-box'>
              <Text className={projectCode ? 'picker-val' : 'picker-ph'}>{projectCode || '选择项目'}</Text>
            </View>
          </Picker>
        </View>

        {/* 详细说明 */}
        <View className='ac-card'>
          <Text className='ac-card-title'>详细说明（选填）</Text>
          <Input
            className='ac-input'
            placeholder='补充说明本次申请的相关信息'
            placeholderClass='ph'
            value={desc}
            onInput={e => setDesc(e.detail.value)}
          />
        </View>
      </ScrollView>

      {/* 底部按钮 */}
      <View className='submit-bar'>
        <View className='submit-btn' onClick={submitting ? undefined : handleSubmit}>
          <Text className='submit-text'>{submitting ? '提交中...' : '提交申请'}</Text>
        </View>
      </View>
    </View>
  );
}
