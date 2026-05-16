import { useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button, Image } from '@tarojs/components';
import { uploadInvoice } from '../../services/api';
import './index.scss';

export default function UploadPage() {
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleChooseImage = async () => {
    try {
      const res = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
      });
      setImages(res.tempFilePaths);
      setResult(null);
    } catch {
      // user cancelled
    }
  };

  const handleUpload = async () => {
    if (images.length === 0) {
      Taro.showToast({ title: '请先选择发票照片', icon: 'none' });
      return;
    }
    setUploading(true);
    try {
      const res = await uploadInvoice(images[0]);
      setResult(`上传成功！\n发票号: ${res.invoice_number || '识别中...'}\n文件名: ${res.file_name}`);
      Taro.showToast({ title: '上传成功', icon: 'success' });
      setTimeout(() => Taro.switchTab({ url: '/pages/invoices/index' }), 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '上传失败', icon: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <View className='page'>
      <View className='upload-area' onClick={handleChooseImage}>
        {images.length > 0 ? (
          <Image className='preview-image' src={images[0]} mode='widthFix' />
        ) : (
          <View className='placeholder'>
            <Text className='placeholder-icon'>📸</Text>
            <Text className='placeholder-text'>点击拍照或从相册选择</Text>
            <Text className='placeholder-hint'>支持 JPG/PNG/PDF 格式</Text>
          </View>
        )}
      </View>

      <Button
        className='upload-btn'
        onClick={handleUpload}
        disabled={uploading || images.length === 0}
        loading={uploading}
      >
        {uploading ? '上传识别中...' : '上传并识别'}
      </Button>

      {result && (
        <View className='result-box'>
          <Text className='result-text'>{result}</Text>
        </View>
      )}
    </View>
  );
}
