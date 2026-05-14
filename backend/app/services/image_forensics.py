"""Image forensics service — detects tampered/manipulated invoice images.

Optimized: images are downscaled to max 800px before analysis;
all per-pixel loops are replaced with vectorized numpy operations.
"""

import io
import logging
import time
from typing import Optional, Dict, Any, List

import numpy as np
from PIL import Image
from PIL.ExifTags import TAGS

logger = logging.getLogger(__name__)

_MAX_DIM = 800  # downscale to this max dimension for speed

_EDITOR_KEYWORDS = [
    'photoshop', 'adobe', 'gimp', 'paint.net', 'pixlr',
    'canva', 'figma', 'sketch', 'affinity', 'corel',
    'lightroom', 'capture one', 'darktable', 'inkscape',
    'photopea', 'paint tool sai', 'krita', 'microsoft photo',
]


class ImageForensicsService:

    def analyze(self, file_data: bytes, file_type: str) -> Dict[str, Any]:
        t0 = time.time()
        findings: List[str] = []

        try:
            image = Image.open(io.BytesIO(file_data))
        except Exception as e:
            logger.error(f"Forensics: cannot open image ({e})")
            return self._empty_result(f'无法打开图像: {e}')

        # Downscale for speed (all detectors work fine on 800px)
        if max(image.size) > _MAX_DIM:
            ratio = _MAX_DIM / max(image.size)
            new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
            image = image.resize(new_size, Image.LANCZOS)

        meta = self._analyze_metadata(image, file_data)
        findings.extend(meta.get('findings', []))

        ela = self._error_level_analysis(image)
        findings.extend(ela.get('findings', []))

        jpeg = self._detect_jpeg_double_compression(image, file_data)
        findings.extend(jpeg.get('findings', []))

        noise = self._analyze_noise_consistency(image)
        findings.extend(noise.get('findings', []))

        score = self._risk_score(meta, ela, jpeg, noise)
        level = 'high' if score >= 70 else ('medium' if score >= 40 else 'low')

        dur = int((time.time() - t0) * 1000)
        logger.info(f"Forensics done: score={score} level={level} findings={len(findings)} {dur}ms")

        return {
            'risk_score': score, 'risk_level': level,
            'metadata_result': meta, 'ela_result': ela,
            'jpeg_double_compression_result': jpeg, 'noise_consistency_result': noise,
            'summary': self._summary(score, level, findings), 'details': findings,
        }

    # ── 1. Metadata ──────────────────────────────────────────────────

    def _analyze_metadata(self, image: Image.Image, raw: bytes) -> Dict[str, Any]:
        findings: List[str] = []
        exif_data: Dict[str, Any] = {}
        flags = {'has_software_tag': False, 'software_suspicious': False,
                 'has_xmp': False, 'xmp_creator_tool': None,
                 'datetime_inconsistent': False, 'no_exif': False}

        try:
            exif = image.getexif()
            if exif:
                for tag_id, value in exif.items():
                    name = TAGS.get(tag_id, str(tag_id))
                    if isinstance(value, bytes):
                        try:
                            value = value.decode('utf-8', errors='replace')
                        except Exception:
                            value = repr(value)
                    exif_data[name] = str(value) if not isinstance(value, (int, float)) else value
                sw = str(exif_data.get('Software', '')).lower()
                if sw:
                    flags['has_software_tag'] = True
                    if any(k in sw for k in _EDITOR_KEYWORDS):
                        flags['software_suspicious'] = True
                        findings.append(f'EXIF Software 标签含编辑软件痕迹: {sw}')
                dto = exif_data.get('DateTimeOriginal', '')
                dt = exif_data.get('DateTime', '')
                if dto and dt and dto != dt:
                    flags['datetime_inconsistent'] = True
                    findings.append('EXIF 日期不一致，文件可能被修改后重新保存')
            else:
                flags['no_exif'] = True
        except Exception as e:
            logger.warning(f"Forensics EXIF: {e}")
            flags['no_exif'] = True

        try:
            head = raw[:20000]
            if b'<x:xmpmeta' in head or b'xmlns:xmp' in head or b'xmp:CreatorTool' in head:
                flags['has_xmp'] = True
                lower = head.lower()
                for kw_bytes in [b'adobe', b'photoshop', b'gimp', b'corel', b'affinity']:
                    if kw_bytes in lower:
                        flags['xmp_creator_tool'] = kw_bytes.decode()
                        flags['software_suspicious'] = True
                        findings.append(f'XMP 元数据含 {kw_bytes.decode()} 创建工具痕迹')
                        break
        except Exception:
            pass

        if image.format == 'PNG':
            try:
                info = getattr(image, 'info', {}) or {}
                for k in ('Software', 'software', 'Creation Time', 'Source'):
                    v = str(info.get(k, '')).lower()
                    if v and any(kw in v for kw in _EDITOR_KEYWORDS):
                        findings.append(f'PNG chunk 含编辑信息: {info.get(k)}')
                        flags['software_suspicious'] = True
                        break
            except Exception:
                pass

        return {'exif': exif_data, 'flags': flags, 'findings': findings,
                'suspicious': flags['software_suspicious']}

    # ── 2. ELA (vectorized) ──────────────────────────────────────────

    def _error_level_analysis(self, image: Image.Image) -> Dict[str, Any]:
        findings: List[str] = []
        flags: Dict[str, Any] = {'ela_performed': False, 'max_error': 0,
                                 'mean_error': 0, 'suspicious_regions': 0, 'clustered': False}

        try:
            rgb = image if image.mode == 'RGB' else image.convert('RGB')
            buf = io.BytesIO()
            rgb.save(buf, format='JPEG', quality=95)
            buf.seek(0)
            recomp = Image.open(buf)

            orig = np.array(rgb, dtype=np.float64)
            rec = np.array(recomp, dtype=np.float64)
            ela = np.mean(np.abs(orig - rec), axis=2)

            flags['ela_performed'] = True
            flags['mean_error'] = round(float(np.mean(ela)), 2)
            flags['max_error'] = round(float(np.max(ela)), 2)

            h, w = ela.shape
            if h >= 128 and w >= 128:
                bs = min(h, w) // 8
                # vectorized block extraction via reshape
                gh, gw = h // bs, w // bs
                crop_h, crop_w = gh * bs, gw * bs
                blocks = ela[:crop_h, :crop_w].reshape(gh, bs, gw, bs).mean(axis=(1, 3))

                gm = float(np.mean(blocks))
                gs = float(np.std(blocks))
                thresh = gm + 3.5 * gs
                susp_map = blocks > thresh
                n_susp = int(np.sum(susp_map))
                flags['suspicious_regions'] = n_susp
                pct = (n_susp / blocks.size) * 100

                if n_susp >= 3 and gh > 1 and gw > 1:
                    visited = np.zeros_like(susp_map, dtype=bool)
                    max_cluster = 0
                    for gy in range(gh):
                        for gx in range(gw):
                            if susp_map[gy, gx] and not visited[gy, gx]:
                                stack = [(gy, gx)]
                                visited[gy, gx] = True
                                size = 0
                                while stack:
                                    cy, cx = stack.pop()
                                    size += 1
                                    for ny, nx in [(cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)]:
                                        if 0 <= ny < gh and 0 <= nx < gw:
                                            if susp_map[ny, nx] and not visited[ny, nx]:
                                                visited[ny, nx] = True
                                                stack.append((ny, nx))
                                if size > max_cluster:
                                    max_cluster = size
                    flags['max_cluster_size'] = max_cluster
                    if max_cluster >= 4 and max_cluster >= n_susp * 0.4:
                        flags['clustered'] = True
                        findings.append(
                            f'ELA: 检测到 {n_susp} 个异常区块({pct:.0f}%)呈空间聚集 '
                            f'(最大连通分量={max_cluster})，可能存在像素级编辑'
                        )
        except Exception as e:
            logger.warning(f"Forensics ELA: {e}")
            flags['error'] = str(e)

        return {'flags': flags, 'findings': findings, 'suspicious': flags.get('clustered', False)}

    # ── 3. JPEG double compression ───────────────────────────────────

    def _detect_jpeg_double_compression(self, image: Image.Image, raw: bytes) -> Dict[str, Any]:
        findings: List[str] = []
        flags: Dict[str, Any] = {'is_jpeg': False, 'estimated_quality': None,
                                 'double_compressed': False, 'quality_mismatch': False}

        try:
            if image.format != 'JPEG':
                return {'flags': flags, 'findings': [], 'suspicious': False}
            flags['is_jpeg'] = True

            if hasattr(image, 'quantization') and image.quantization:
                qt = image.quantization
                qtable = np.array(qt.get(0, qt.get(next(iter(qt.keys())) if qt else 0)))
                if qtable.size:
                    flags['estimated_quality'] = self._qtable_to_quality(qtable)

            test_img = image if image.mode == 'RGB' else image.convert('RGB')
            orig_sz = len(raw)
            sizes = {}
            for q in (70, 85, 95):
                b = io.BytesIO()
                test_img.save(b, format='JPEG', quality=q)
                sizes[q] = len(b.getvalue())
            flags.update({f'size_at_{k}': v for k, v in sizes.items()})
            flags['original_size'] = orig_sz

            if sizes.get(95, 0) < orig_sz * 0.8:
                flags['quality_mismatch'] = True
                findings.append('JPEG 重新保存后文件显著变小，原始来源可能是无损/高质量格式，存在格式转换嫌疑')

            sz_range = max(sizes.values()) - min(sizes.values())
            if orig_sz > 0 and sz_range < orig_sz * 0.05:
                flags['flat_size_curve'] = True
                findings.append('JPEG 压缩曲线异常平坦，可能经过重度编辑后重新保存')

        except Exception as e:
            logger.warning(f"Forensics JPEG ghost: {e}")
            flags['error'] = str(e)

        return {'flags': flags, 'findings': findings,
                'suspicious': flags.get('double_compressed') or flags.get('quality_mismatch')}

    @staticmethod
    def _qtable_to_quality(qtable: np.ndarray) -> Optional[int]:
        try:
            std50 = np.array([
                [16, 11, 10, 16, 24, 40, 51, 61],
                [12, 12, 14, 19, 26, 58, 60, 55],
                [14, 13, 16, 24, 40, 57, 69, 56],
                [14, 17, 22, 29, 51, 87, 80, 62],
                [18, 22, 37, 56, 68, 109, 103, 77],
                [24, 35, 55, 64, 81, 104, 113, 92],
                [49, 64, 78, 87, 103, 121, 120, 101],
                [72, 92, 95, 98, 112, 100, 103, 99],
            ], dtype=np.float64)
            if qtable.shape != std50.shape:
                return None
            ratio = float(np.mean(qtable) / np.mean(std50))
            if ratio <= 0:
                return 100
            if ratio < 1:
                return max(1, min(100, int(5000.0 / ratio)))
            return max(1, min(100, int(200 - ratio * 2)))
        except Exception:
            return None

    # ── 4. Noise consistency (integral-image box filter) ─────────────

    def _analyze_noise_consistency(self, image: Image.Image) -> Dict[str, Any]:
        findings: List[str] = []
        flags: Dict[str, Any] = {'noise_std': 0, 'noise_uniformity': 0,
                                 'smooth_block_count': 0, 'suspicious_variance': False}

        try:
            gray = np.array(image.convert('L'), dtype=np.float64)
            h, w = gray.shape
            if h < 128 or w < 128:
                return {'flags': flags, 'findings': [], 'suspicious': False}

            # Fast box filter via integral image: O(1) per output pixel
            k = 5
            local_mean = _box_filter(gray, k)
            pad = k // 2
            cropped = gray[pad:pad + local_mean.shape[0], pad:pad + local_mean.shape[1]]
            noise = cropped - local_mean
            nh, nw = noise.shape

            noise_std = float(np.std(noise))
            flags['noise_std'] = round(noise_std, 2)

            bs = max(32, min(h, w) // 10)
            if nh < bs * 2 or nw < bs * 2:
                return {'flags': flags, 'findings': [], 'suspicious': False}

            # vectorized block-wise variance on original image for texture classification
            gh, gw = nh // bs, nw // bs
            crop_h, crop_w = gh * bs, gw * bs
            blocks_orig = cropped[:crop_h, :crop_w].reshape(gh, bs, gw, bs)
            block_var = np.var(blocks_orig, axis=(1, 3))  # (gh, gw) variance map

            # noise std per block
            blocks_noise = noise[:crop_h, :crop_w].reshape(gh, bs, gw, bs)
            block_noise_std = np.std(blocks_noise, axis=(1, 3))  # (gh, gw)

            smooth_mask = (block_var < 200).ravel()
            smooth_stds = block_noise_std.ravel()[smooth_mask]
            flags['smooth_block_count'] = int(np.sum(smooth_mask))

            if len(smooth_stds) >= 6:
                ms = float(np.mean(smooth_stds))
                ss = float(np.std(smooth_stds))
                flags['noise_uniformity'] = round(ss / ms, 3) if ms > 1e-6 else 0
                if ss > ms * 1.0 and ms > 0.5:
                    flags['suspicious_variance'] = True
                    findings.append(
                        f'噪声一致性异常: {flags["smooth_block_count"]} 个背景区块噪声CV={flags["noise_uniformity"]:.2f}，'
                        '可能存在编辑后抹平的拼接区域'
                    )

        except Exception as e:
            logger.warning(f"Forensics noise: {e}")
            flags['error'] = str(e)

        return {'flags': flags, 'findings': findings, 'suspicious': flags.get('suspicious_variance')}

    # ── Scoring ──────────────────────────────────────────────────────

    @staticmethod
    def _risk_score(meta: Dict, ela: Dict, jpeg: Dict, noise: Dict) -> int:
        score = 0
        if meta.get('flags', {}).get('software_suspicious'):
            score += 35
        elif meta.get('flags', {}).get('no_exif'):
            score += 10
        if ela.get('flags', {}).get('clustered'):
            cluster_size = ela['flags'].get('max_cluster_size', 0)
            score += 30 if cluster_size >= 8 else 18
        if jpeg.get('flags', {}).get('double_compressed'):
            score += 30
        if jpeg.get('flags', {}).get('quality_mismatch'):
            score += 25
        if noise.get('flags', {}).get('suspicious_variance'):
            score += 20
        return min(100, score)

    @staticmethod
    def _summary(score: int, level: str, details: List[str]) -> str:
        pre = {
            'high': '高风险: 该图像存在明显的编辑或造假痕迹，强烈建议人工复核原始文件。',
            'medium': '中风险: 该图像存在可疑特征，建议人工复核关键字段（金额、日期）。',
            'low': '低风险: 未检测到明显的图像篡改痕迹。',
        }.get(level, '无法评估。')
        if details:
            pre += f' 检测到 {len(details)} 条可疑特征。'
        return pre

    @staticmethod
    def _empty_result(msg: str) -> Dict[str, Any]:
        return {
            'risk_score': 0, 'risk_level': 'unknown',
            'metadata_result': {}, 'ela_result': {},
            'jpeg_double_compression_result': {}, 'noise_consistency_result': {},
            'summary': msg, 'details': [msg],
        }


# ── Fast box filter via integral image ───────────────────────────────

def _box_filter(arr: np.ndarray, k: int) -> np.ndarray:
    """O(1) per-pixel box filter using integral images (cumulative sum trick)."""
    # 2D cumulative sum (integral image)
    integral = np.cumsum(np.cumsum(arr, axis=0), axis=1)
    h, w = arr.shape
    out_h, out_w = h - k + 1, w - k + 1
    # pad integral image with zeros at top/left for clean indexing
    integral_pad = np.pad(integral, ((1, 0), (1, 0)), mode='constant')
    # sum = integral[i+k, j+k] - integral[i, j+k] - integral[i+k, j] + integral[i, j]
    a = integral_pad[k:, k:]  # bottom-right
    b = integral_pad[:out_h, k:]  # top-right
    c = integral_pad[k:, :out_w]  # bottom-left
    d = integral_pad[:out_h, :out_w]  # top-left
    return (a[:out_h, :out_w] - b - c + d) / (k * k)


# ── Singleton ────────────────────────────────────────────────────────

_forensics: Optional[ImageForensicsService] = None


def get_forensics_service() -> ImageForensicsService:
    global _forensics
    if _forensics is None:
        _forensics = ImageForensicsService()
    return _forensics
